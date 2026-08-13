from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.settings import router as settings_router
from app.api.labels import router as labels_router
from app.api.batches import router as batches_router
from app.api.images import router as images_router
from app.api.locks import router as locks_router
from app.api.annotations import router as annotations_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(users_router, tags=["users"])
api_router.include_router(settings_router, tags=["settings"])
api_router.include_router(labels_router, tags=["labels"])
api_router.include_router(batches_router, tags=["batches"])
api_router.include_router(images_router, tags=["images"])
api_router.include_router(locks_router, tags=["locks"])
api_router.include_router(annotations_router, tags=["annotations"])


@api_router.get("/health")
def health():
    return {"status": "ok"}
