from __future__ import annotations

import logging
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from app import __version__, auth as auth_service
from app.api.auth import router as auth_router
from app.api.data import router as data_router
from app.api.ext_data import router as ext_data_router
from app.api.financials import router as financials_router
from app.api.indices import router as indices_router
from app.api.kline import router as kline_router
from app.api.overview import router as overview_router
from app.api.pipeline import router as pipeline_router
from app.api.settings import router as settings_router
from app.api.strategies import router as strategies_router
from app.api.ai import router as ai_router
from app.api.factors import router as factors_router
from app.api.monitor import router as monitor_router
from app.api.news import router as news_router
from app.api.signals import router as signals_router
from app.api.users import router as users_router
from app.api.watchlist import router as watchlist_router
from app.config import get_settings
from app.db import create_database_engine, create_session_factory, init_database, session_scope
from app.tickflow.capabilities import CapabilityDenied

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_AUTH_WHITELIST_PREFIX = ("/api/auth/status", "/api/auth/setup", "/api/auth/login")
_AUTH_WHITELIST_EXACT = ("/health", "/api/health", "/openapi.json", "/docs", "/redoc")


def _setup_backend_file_log(data_dir: Path) -> None:
    if getattr(sys, "frozen", False):
        return
    try:
        from logging.handlers import RotatingFileHandler

        data_dir.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            data_dir / "backend.log",
            maxBytes=8 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
        logging.getLogger().addHandler(handler)
    except Exception as exc:  # noqa: BLE001
        logger.warning("文件日志初始化失败, 仅输出到终端: %s", exc)


async def _start_market_data(app: FastAPI) -> None:
    """TSP 数据层启动: 仓库、能力探测、盘后管道、实时/分钟增量。"""
    from app.jobs import daily_pipeline
    from app.services.quote_service import QuoteService
    from app.tickflow.client import current_mode
    from app.tickflow.policy import detect_capabilities
    from app.tickflow.repository import DataStore, KlineRepository

    settings = get_settings()
    _setup_backend_file_log(settings.data_dir)
    logger.info("market data starting (mode=%s)", current_mode())

    store = DataStore(settings.data_dir)
    repo = KlineRepository(store)
    app.state.datastore = store
    app.state.repo = repo
    from app.strategy.market_data import _set_repo

    _set_repo(repo)
    app.state.indicators_ready = False
    repo._on_warmup_done = lambda: setattr(app.state, "indicators_ready", True)  # noqa: SLF001
    repo.refresh_cache(background=True)

    try:
        from app.data_providers import custom as custom_sources

        custom_sources.load_all()
        logger.info("custom data sources loaded: %d", len(custom_sources.list_sources()))
    except Exception as exc:  # noqa: BLE001
        logger.warning("custom data sources init failed: %s", exc)

    capset = detect_capabilities()
    app.state.capabilities = capset
    logger.info("ready; %d capabilities active", len(capset.all()))

    qs = QuoteService()
    app.state.quote_service = qs
    qs.set_repo(repo)
    qs.boot_check()

    from app.strategy.monitor import StrategyMonitorService

    strategy_monitor = StrategyMonitorService()
    app.state.strategy_monitor = strategy_monitor
    from app.services.user_strategy_monitor import UserStrategyMonitor

    app.state.user_strategy_monitor = UserStrategyMonitor()
    qs.set_app_state(app.state)

    from app.services.depth_service import DepthService

    depth_service = DepthService()
    depth_service.set_repo(repo)
    depth_service.set_app_state(app.state)
    app.state.depth_service = depth_service

    try:
        daily_pipeline.set_app_state(app.state)
        scheduler = daily_pipeline.start_scheduler(repo, capset)
        app.state.scheduler = scheduler
    except Exception as exc:  # noqa: BLE001
        logger.warning("scheduler not started: %s", exc)
        app.state.scheduler = None

    try:
        depth_service.boot_check()
        depth_service.start_polling()
    except Exception as exc:  # noqa: BLE001
        logger.warning("depth_service init failed: %s", exc)

    try:
        from app.services.minute_refresh import MinuteRefreshService

        minute_refresh = MinuteRefreshService(repo)
        minute_refresh.set_app_state(app.state)
        app.state.minute_refresh = minute_refresh
        minute_refresh.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("minute_refresh init failed: %s", exc)

    try:
        import threading

        from app.services.data_integrity import boot_integrity_check

        timer = threading.Timer(30.0, boot_integrity_check, args=(app.state,))
        timer.daemon = True
        timer.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("integrity boot check scheduling failed: %s", exc)

    try:
        from app.services.ext_presets import ensure_builtin_presets

        await ensure_builtin_presets(store.data_dir)
    except Exception as exc:  # noqa: BLE001
        logger.warning("内置扩展表初始化失败 (不影响启动): %s", exc)

    from app.services.ext_pull import pull_scheduler

    pull_scheduler.start(store.data_dir)
    pull_scheduler.refresh(store.data_dir)
    app.state.pull_scheduler = pull_scheduler

    from app.services.financial_sync import financial_scheduler

    financial_scheduler.start(store.data_dir, capset)
    app.state.financial_scheduler = financial_scheduler

    from app.watchdog import start_watchdog

    app.state.watchdog = start_watchdog(app.state, repo)


async def _stop_market_data(app: FastAPI) -> None:
    repo = getattr(app.state, "repo", None)
    if repo is not None:
        repo._on_refresh_done = None  # noqa: SLF001
    wd = getattr(app.state, "watchdog", None)
    if wd:
        await wd.stop()
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        scheduler.shutdown(wait=False)
    ps = getattr(app.state, "pull_scheduler", None)
    if ps:
        ps.stop()
    fsc = getattr(app.state, "financial_scheduler", None)
    if fsc:
        fsc.stop()
    qs = getattr(app.state, "quote_service", None)
    if qs:
        qs.stop()
    dsvc = getattr(app.state, "depth_service", None)
    if dsvc:
        dsvc.stop_polling()
    mrs = getattr(app.state, "minute_refresh", None)
    if mrs:
        mrs.stop()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = create_database_engine(settings)
    init_database(engine)
    session_factory = create_session_factory(engine)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    with session_scope(session_factory) as database:
        admin = auth_service.bootstrap_admin(database, settings)
        if admin is not None:
            logger.info("bootstrapped admin user %s", admin.email)
        from app.services.market_catalog import seed_market_strategies

        seed_market_strategies(database)
    await _start_market_data(app)
    try:
        yield
    finally:
        await _stop_market_data(app)
        engine.dispose()
        logger.info("shutdown")


settings = get_settings()
app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    if path in _AUTH_WHITELIST_EXACT or any(path.startswith(prefix) for prefix in _AUTH_WHITELIST_PREFIX):
        return await call_next(request)
    if path == "/api/auth/logout":
        return await call_next(request)

    cookie_name = get_settings().session_cookie_name
    token = request.cookies.get(cookie_name)
    if not token:
        return JSONResponse(status_code=401, content={"detail": "未登录或会话已过期"})
    return await call_next(request)


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.exception_handler(CapabilityDenied)
async def capability_denied_handler(request: Request, exc: CapabilityDenied) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc)})


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(data_router)
app.include_router(pipeline_router)
app.include_router(overview_router)
app.include_router(kline_router)
app.include_router(indices_router)
app.include_router(financials_router)
app.include_router(settings_router)
app.include_router(strategies_router)
app.include_router(factors_router)
app.include_router(monitor_router)
app.include_router(signals_router)
app.include_router(news_router)
app.include_router(ext_data_router)
app.include_router(ai_router)
app.include_router(watchlist_router)

_MOBILE_UA = re.compile(
    r"Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Mobile",
    re.I,
)

_static = Path(settings.static_dir)
if _static.exists():
    assets = _static / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    mobile_assets = _static / "m" / "assets"
    if mobile_assets.exists():
        app.mount("/m/assets", StaticFiles(directory=mobile_assets), name="mobile-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(request: Request, full_path: str):
        root = _static.resolve()
        mobile_root = (root / "m").resolve()
        ua = request.headers.get("user-agent") or ""
        is_mobile = bool(_MOBILE_UA.search(ua))
        wants_mobile = full_path == "m" or full_path.startswith("m/")
        if is_mobile and not wants_mobile:
            rest = full_path.strip("/")
            if rest in {"", "strategies"}:
                rest = "watchlist"
            return RedirectResponse(f"/m/{rest}", status_code=302)
        if not is_mobile and wants_mobile:
            rest = full_path[1:].lstrip("/") if full_path.startswith("m") else full_path
            rest = rest[1:].lstrip("/") if rest.startswith("/") else rest
            if rest.startswith("m/"):
                rest = rest[2:]
            elif rest == "m":
                rest = ""
            dest = f"/{rest}" if rest else "/watchlist"
            if dest == "/":
                dest = "/watchlist"
            return RedirectResponse(dest, status_code=302)
        if wants_mobile:
            rel = full_path[2:] if full_path.startswith("m/") else ""
            if rel:
                candidate = (mobile_root / rel).resolve()
                if candidate.is_file() and (candidate == mobile_root or mobile_root in candidate.parents):
                    return FileResponse(candidate)
            index = mobile_root / "index.html"
            if index.exists():
                return FileResponse(index, headers={"Cache-Control": "no-store, must-revalidate"})
            return JSONResponse({"error": "mobile frontend not built"}, status_code=404)
        if full_path:
            candidate = (root / full_path).resolve()
            if candidate.is_file() and (candidate == root or root in candidate.parents):
                return FileResponse(candidate)
        index = root / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-store, must-revalidate"})
        return JSONResponse({"error": "frontend not built"}, status_code=404)
