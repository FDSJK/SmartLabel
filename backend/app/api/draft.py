from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.user import User
from app.schemas.draft import DraftResponse, DraftSaveRequest, DraftAcceptRequest, DraftAcceptResponse
from app.api.deps import get_current_user, get_owned_image
from app.services.draft_store import read_draft, write_draft, delete_draft
from app.services.annotation_store import read_annotation, write_annotation
from app.services.work_dir import get_work_dir
from app.services.status import derive_image_status

router = APIRouter()


@router.get("/images/{image_id}/draft", response_model=DraftResponse)
def get_draft(image_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, img.batch.name, img.file_name)
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No draft")
    return DraftResponse(**draft)


@router.put("/images/{image_id}/draft", response_model=DraftResponse)
def save_draft(image_id: int, body: DraftSaveRequest, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, img.batch.name, img.file_name)
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No draft")
    draft["shapes"] = [s.model_dump() for s in body.shapes]
    write_draft(work_dir, img.batch.name, img.file_name, draft)
    return DraftResponse(**draft)


@router.post("/images/{image_id}/draft/accept", response_model=DraftAcceptResponse)
def accept_draft(image_id: int, body: DraftAcceptRequest, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    if body.expectedRev != img.annotation_rev:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Version conflict: expected {body.expectedRev}, server {img.annotation_rev}")
    batch = img.batch
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, batch.name, img.file_name)
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No draft")

    existing = read_annotation(work_dir, batch.name, img.file_name)
    shapes = list(existing.get("shapes", [])) if existing else []
    label_status = dict(existing.get("labelStatus", {})) if existing else {}

    # 覆盖：接受预分割的标签，替换掉该标签已有的手工 shapes，避免叠加；其它标签不动
    draft_shapes = draft.get("shapes", [])
    draft_labels = {s["label"] for s in draft_shapes}
    shapes = [s for s in shapes if s.get("label") not in draft_labels]
    shapes.extend(draft_shapes)
    for s in draft_shapes:
        label_status[s["label"]] = "present"

    saved = write_annotation(
        work_dir=work_dir, batch_name=batch.name, file_name=img.file_name,
        shapes=shapes, label_status=label_status,
        image_width=img.width, image_height=img.height,
        username=current_user.username, current_version=img.annotation_rev,
    )
    img.annotation_rev = saved["version"]
    img.status = derive_image_status(db, label_status)
    db.commit()
    delete_draft(work_dir, batch.name, img.file_name)
    return DraftAcceptResponse(rev=saved["version"], shapes=shapes, labelStatus=label_status)


@router.delete("/images/{image_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
def reject_draft(image_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    delete_draft(work_dir, img.batch.name, img.file_name)
