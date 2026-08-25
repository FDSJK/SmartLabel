import logging
import os
import shutil
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from app.core.db import get_db
import app.core.config as _config
from app.models.model_config import ModelConfig
from app.models.inference_job import InferenceJob
from app.models.user import User
from app.schemas.model_config import ModelConfigCreate, ModelConfigUpdate, ModelConfigResponse
from app.api.deps import get_current_user, require_admin
from app.services.onnx_service import invalidate_session, _resolve_model_path

router = APIRouter()

logger = logging.getLogger(__name__)


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
    existing = db.query(ModelConfig).filter(ModelConfig.name == body.name, ModelConfig.id != model_id).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Model name already exists")
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
    # 先释放缓存的推理 session（关闭文件句柄）。
    invalidate_session(cfg.id)
    # source=upload 的 onnx 文件在 MODELS_DIR 下，随配置一并删除；source=path 指向服务器文件，不动它。
    # 仅当没有其它配置共用同一文件时才删除，避免误删仍在使用的模型。
    file_path = None
    if cfg.source == "upload":
        shared = db.query(ModelConfig).filter(
            ModelConfig.id != model_id,
            ModelConfig.source == "upload",
            ModelConfig.model_path == cfg.model_path,
        ).first()
        if not shared:
            file_path = _resolve_model_path(cfg)
    # 删除该模型的历史推理任务，否则外键约束会导致删除配置失败（IntegrityError）。
    db.query(InferenceJob).filter(InferenceJob.model_config_id == model_id).delete(synchronize_session=False)
    db.delete(cfg)
    db.commit()
    # 记录删除成功后再删文件；文件删不掉不影响记录，只记录告警。
    if file_path and os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError as exc:
            logger.warning("删除模型文件失败 %s: %s", file_path, exc)


@router.post("/models/upload")
async def upload_model(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if not file.filename or not file.filename.lower().endswith(".onnx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .onnx files are allowed")
    os.makedirs(_config.settings.MODELS_DIR, exist_ok=True)
    name = os.path.basename(file.filename)
    dest = os.path.join(_config.settings.MODELS_DIR, name)
    if os.path.exists(dest):
        raise HTTPException(status.HTTP_409_CONFLICT, f"模型文件 {name} 已存在")
    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    return {"filename": name}
