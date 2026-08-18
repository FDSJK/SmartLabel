from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
import app.core.config as _config
from app.models.setting import Setting
from app.models.user import User
from app.api.deps import get_current_user
from app.schemas.stats import StatsResponse
from app.services.stats import compute_stats

router = APIRouter()


def _get_work_dir(db: Session) -> str:
    row = db.query(Setting).filter(Setting.key == "WORK_DIR").first()
    if row and row.value.strip():
        return row.value.strip()
    return _config.settings.WORK_DIR


@router.get("/stats", response_model=StatsResponse)
def get_stats(
    batch_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    work_dir = _get_work_dir(db)
    result = compute_stats(work_dir, db, batch_id)
    return StatsResponse(totalImages=result["total_images"], labels=result["labels"])
