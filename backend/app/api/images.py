import os
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.db import get_db
import app.core.config as _config
from app.models.image import Image
from app.models.setting import Setting
from app.models.user import User
from app.api.deps import get_current_user
from app.models.batch import Batch
from app.schemas.annotation import MaskExportRequest, MaskExportResponse
from app.services.mask_export import export_image_masks

router = APIRouter()

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _get_work_dir(db: Session) -> str:
    row = db.query(Setting).filter(Setting.key == "WORK_DIR").first()
    if row and row.value.strip():
        return row.value.strip()
    return _config.settings.WORK_DIR


@router.get("/images/{image_id}/file")
def serve_image_file(
    image_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    work_dir = _get_work_dir(db)
    rel_path = img.work_rel_path or img.src_rel_path
    abs_path = os.path.join(work_dir, rel_path)

    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found on disk")

    ext = os.path.splitext(abs_path)[1].lower()
    media_type = MIME_MAP.get(ext, "application/octet-stream")

    return FileResponse(abs_path, media_type=media_type)


@router.post("/images/{image_id}/export-mask", response_model=MaskExportResponse)
def export_mask(
    image_id: int,
    body: MaskExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    batch = db.query(Batch).filter(Batch.id == img.batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = _get_work_dir(db)
    shapes_dicts = [
        {"id": s.id, "label": s.label, "shapeType": s.shapeType,
         "points": s.points, "holes": s.holes}
        for s in body.shapes
    ]
    result = export_image_masks(work_dir, batch, img, shapes_dicts, body.labelStatus)
    return MaskExportResponse(saved=result["saved"], errors=result["errors"])
