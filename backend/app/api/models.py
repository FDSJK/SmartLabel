import os
import shutil
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from app.core.db import get_db
import app.core.config as _config
from app.models.model_config import ModelConfig
from app.models.user import User
from app.schemas.model_config import ModelConfigCreate, ModelConfigUpdate, ModelConfigResponse
from app.api.deps import get_current_user, require_admin
from app.services.onnx_service import invalidate_session

router = APIRouter()


@router.get("/models", response_model=list[ModelConfigResponse])
def list_models(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ModelConfig).order_by(ModelConfig.created_at.desc()).all()


@router.post("/models", response_model=ModelConfigResponse, status_code=status.HTTP_201_CREATED)
def create_model(body: ModelConfigCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(ModelConfig).filter(ModelConfig.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Model name already exists")
    cfg = ModelConfig(**body.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/models/{model_id}", response_model=ModelConfigResponse)
def update_model(model_id: int, body: ModelConfigUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not cfg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")
    for k, v in body.model_dump().items():
        setattr(cfg, k, v)
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cfg)
    invalidate_session(cfg.id)
    return cfg


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not cfg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")
    invalidate_session(cfg.id)
    db.delete(cfg)
    db.commit()


@router.post("/models/upload")
async def upload_model(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if not file.filename or not file.filename.lower().endswith(".onnx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .onnx files are allowed")
    os.makedirs(_config.settings.MODELS_DIR, exist_ok=True)
    name = os.path.basename(file.filename)
    dest = os.path.join(_config.settings.MODELS_DIR, name)
    if os.path.exists(dest):
        stem, ext = os.path.splitext(name)
        name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
        dest = os.path.join(_config.settings.MODELS_DIR, name)
    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    return {"filename": name}
