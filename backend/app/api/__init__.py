from fastapi import APIRouter
from app.api.auth import router as auth_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, tags=["auth"])


@api_router.get("/health")
def health():
    return {"status": "ok"}
