import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.batch import Batch
from app.models.image import Image
from app.models.user import User
from app.schemas.annotation import (
    AnnotationSaveRequest,
    AnnotationReadResponse,
    AnnotationResponse,
)
from app.api.deps import get_current_user
from app.services.annotation_store import read_annotation, write_annotation
from app.services.work_dir import get_work_dir

router = APIRouter()


@router.get("/images/{image_id}/annotation", response_model=AnnotationReadResponse)
def get_annotation(
    image_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    batch = db.query(Batch).filter(Batch.id == img.batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = get_work_dir(db, _user)
    data = read_annotation(work_dir, batch.name, img.file_name)

    if data is None:
        # Return empty annotation
        return AnnotationReadResponse(
            schemaVersion=1,
            imageName=img.file_name,
            imageWidth=img.width,
            imageHeight=img.height,
            shapes=[],
            labelStatus={},
            version=img.annotation_rev,
        )

    return AnnotationReadResponse(
        schemaVersion=data.get("schemaVersion", 1),
        imageName=data.get("imageName", img.file_name),
        imageWidth=data.get("imageWidth", img.width),
        imageHeight=data.get("imageHeight", img.height),
        shapes=data.get("shapes", []),
        labelStatus=data.get("labelStatus", {}),
        version=data.get("version", img.annotation_rev),
    )


@router.put("/images/{image_id}/annotation", response_model=AnnotationResponse)
def save_annotation(
    image_id: int,
    body: AnnotationSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    # Optimistic locking
    if body.expectedRev != img.annotation_rev:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Version conflict: expected rev {body.expectedRev}, server rev {img.annotation_rev}",
        )

    batch = db.query(Batch).filter(Batch.id == img.batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = get_work_dir(db, current_user)

    # Convert shapes to dicts
    shapes_dicts = [
        {
            "id": s.id,
            "label": s.label,
            "shapeType": s.shapeType,
            "points": s.points,
            "holes": s.holes,
        }
        for s in body.shapes
    ]

    saved = write_annotation(
        work_dir=work_dir,
        batch_name=batch.name,
        file_name=img.file_name,
        shapes=shapes_dicts,
        label_status=body.labelStatus,
        image_width=img.width,
        image_height=img.height,
        username=current_user.username,
        current_version=img.annotation_rev,
    )

    # Update DB
    img.annotation_rev = saved["version"]
    if img.status == "pending":
        img.status = "in_progress"
    img.updated_at = datetime.utcnow()
    db.commit()

    return AnnotationResponse(
        rev=saved["version"],
        shapes=body.shapes,
        labelStatus=body.labelStatus,
        savedAt=saved["updatedAt"],
    )
