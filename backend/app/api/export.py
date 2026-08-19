from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.user import User
from app.api.deps import get_current_user
from app.schemas.export import ExportRequest, ExportResponse
from app.services.exporter import collect_scope, compute_pending, generate_export
from app.services.work_dir import get_work_dir

router = APIRouter()


@router.post("/export", response_model=ExportResponse)
def export(
    body: ExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    work_dir = get_work_dir(db, current_user)
    collected = collect_scope(work_dir, db, body.scope, body.imageId, body.batchId)
    if not collected["images"]:
        if body.scope == "image":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No images in scope")

    pending = compute_pending(collected["items"], collected["labels"])
    if pending and not body.skipUnconfirmed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "unconfirmed_labels", "pending": pending},
        )

    result = generate_export(
        work_dir, db,
        scope=body.scope, image_id=body.imageId, batch_id=body.batchId,
        collected=collected, formats=body.formats, username=current_user.username,
    )
    return ExportResponse(
        exportDir=result["export_dir"],
        imageCount=result["image_count"],
        annotationCount=result["annotation_count"],
        maskCount=result["mask_count"],
        pending=pending,
        errors=result["errors"],
    )
