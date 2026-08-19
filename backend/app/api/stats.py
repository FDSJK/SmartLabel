from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.user import User
from app.api.deps import get_current_user
from app.schemas.stats import StatsResponse
from app.services.stats import compute_stats
from app.services.work_dir import get_work_dir

router = APIRouter()


@router.get("/stats", response_model=StatsResponse)
def get_stats(
    batch_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    work_dir = get_work_dir(db, current_user)
    result = compute_stats(work_dir, db, batch_id, created_by=current_user.id)
    return StatsResponse(totalImages=result["total_images"], labels=result["labels"])
