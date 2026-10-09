from fastapi import APIRouter

from app.api.routes import dashboard, health, strategies, workspaces

api_router = APIRouter()
api_router.include_router(health.router, tags=["system"])
api_router.include_router(dashboard.router, tags=["dashboard"])
api_router.include_router(workspaces.router)
api_router.include_router(strategies.router)
