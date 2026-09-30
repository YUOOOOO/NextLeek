from datetime import UTC, datetime
from os import cpu_count, getloadavg
from time import monotonic

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()
_started_at = monotonic()


@router.get("/dashboard")
async def dashboard() -> dict[str, object]:
    load_1m, load_5m, load_15m = getloadavg()
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "service": {
            "status": "online",
            "name": "nextleek-backend",
            "version": "3.0.0",
            "environment": settings.env,
            "uptime_seconds": round(monotonic() - _started_at),
        },
        "runtime": {
            "architecture": "isolated-worker",
            "cpu_count": cpu_count() or 1,
            "load_average": {
                "one_minute": round(load_1m, 2),
                "five_minutes": round(load_5m, 2),
                "fifteen_minutes": round(load_15m, 2),
            },
        },
        "modules": [
            {"id": "research", "name": "因子研究", "path": "/research", "state": "ready"},
            {"id": "strategies", "name": "策略管理", "path": "/strategies", "state": "ready"},
            {"id": "live", "name": "实时运行", "path": "/live", "state": "ready"},
        ],
    }
