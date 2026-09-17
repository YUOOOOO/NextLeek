from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__, auth as auth_service
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.config import get_settings
from app.db import create_database_engine, create_session_factory, init_database, session_scope

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_AUTH_WHITELIST_PREFIX = ("/api/auth/status", "/api/auth/setup", "/api/auth/login")
_AUTH_WHITELIST_EXACT = ("/health", "/api/health", "/openapi.json", "/docs", "/redoc")


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
    logger.info("NextLeek v%s starting", __version__)
    try:
        yield
    finally:
        engine.dispose()


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


app.include_router(auth_router)
app.include_router(users_router)

_static = Path(settings.static_dir)
if _static.exists():
    assets = _static / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        root = _static.resolve()
        if full_path:
            candidate = (root / full_path).resolve()
            if candidate.is_file() and (candidate == root or root in candidate.parents):
                return FileResponse(candidate)
        index = root / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-store, must-revalidate"})
        return JSONResponse({"error": "frontend not built"}, status_code=404)
