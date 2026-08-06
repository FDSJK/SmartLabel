from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.settings import router as settings_router
from app.api.labels import router as labels_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(users_router, tags=["users"])
api_router.include_router(settings_router, tags=["settings"])
api_router.include_router(labels_router, tags=["labels"])


@api_router.get("/health")
def health():
    return {"status": "ok"}
