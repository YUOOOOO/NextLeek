from datetime import UTC, datetime

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "nextleek-backend",
        "version": "3.0.0",
        "time": datetime.now(UTC).isoformat(),
    }


@router.get("/system/info")
async def system_info() -> dict[str, str]:
    return {"environment": settings.env, "architecture": "v3-clean-room"}
