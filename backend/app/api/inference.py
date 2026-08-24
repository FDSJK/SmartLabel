import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.db import get_db
import app.core.db as _db
from app.models.model_config import ModelConfig
from app.models.inference_job import InferenceJob
from app.models.image import Image
from app.models.user import User
from app.schemas.inference import InferenceTriggerResponse, BatchInferenceResponse, InferenceJobResponse
from app.api.deps import get_current_user, require_work_dir, get_owned_image, get_owned_batch
from app.services import onnx_service
from app.services.draft_store import write_draft
from app.services.work_dir import get_work_dir

router = APIRouter()


def _image_abs_path(work_dir: str, img: Image) -> str:
    return os.path.join(work_dir, img.work_rel_path or img.src_rel_path)


def _run_job(job_id: int) -> None:
    db = _db._SessionLocal()
    try:
        job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
        if not job:
            return
        job.status = "running"
        db.commit()

        cfg = db.query(ModelConfig).filter(ModelConfig.id == job.model_config_id).first()
        img = db.query(Image).filter(Image.id == job.image_id).first()
        batch = img.batch
        user = db.query(User).filter(User.id == job.requested_by).first()
        work_dir = get_work_dir(db, user)
        path = _image_abs_path(work_dir, img)

        shapes = onnx_service.run_inference(cfg, path)
        write_draft(work_dir, batch.name, img.file_name, {
            "imageName": img.file_name,
            "modelConfigId": cfg.id,
            "modelName": cfg.name,
            "createdAt": datetime.now(timezone.utc).isoformat() + "Z",
            "shapes": shapes,
        })
        job.status = "done"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.error = str(e)
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


@router.post("/models/{model_id}/inference/{image_id}", response_model=InferenceTriggerResponse)
def trigger_single(model_id: int, image_id: int, background_tasks: BackgroundTasks,
                   db: Session = Depends(get_db), current_user: User = Depends(require_work_dir)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id, ModelConfig.enabled == True).first()  # noqa: E712
    if not cfg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found or disabled")
    img = get_owned_image(db, current_user, image_id)
    job = InferenceJob(image_id=img.id, model_config_id=cfg.id, requested_by=current_user.id,
                       scope="single", status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_job, job.id)
    return InferenceTriggerResponse(jobId=job.id)


@router.post("/models/{model_id}/inference/batch/{batch_id}", response_model=BatchInferenceResponse)
def trigger_batch(model_id: int, batch_id: int, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db), current_user: User = Depends(require_work_dir)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id, ModelConfig.enabled == True).first()  # noqa: E712
    if not cfg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found or disabled")
    batch = get_owned_batch(db, current_user, batch_id)
    images = db.query(Image).filter(Image.batch_id == batch.id).all()
    job_ids = []
    for img in images:
        job = InferenceJob(image_id=img.id, model_config_id=cfg.id, requested_by=current_user.id,
                           scope="batch", status="queued")
        db.add(job)
        db.flush()
        job_ids.append(job.id)
    db.commit()
    for jid in job_ids:
        background_tasks.add_task(_run_job, jid)
    return BatchInferenceResponse(queued=len(job_ids), jobIds=job_ids)


@router.get("/inference-jobs/{job_id}", response_model=InferenceJobResponse)
def get_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
    if not job or job.requested_by != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@router.get("/inference-jobs", response_model=list[InferenceJobResponse])
def list_jobs(image_id: int | None = None, batch_id: int | None = None,
              db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(InferenceJob).filter(InferenceJob.requested_by == current_user.id)
    if image_id is not None:
        q = q.filter(InferenceJob.image_id == image_id)
    if batch_id is not None:
        q = q.join(Image, InferenceJob.image_id == Image.id).filter(Image.batch_id == batch_id)
    return q.order_by(InferenceJob.id.desc()).all()
