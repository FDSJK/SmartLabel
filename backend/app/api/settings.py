from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.setting import Setting
from app.models.user import User
from app.schemas.setting import SettingUpdate
from app.api.deps import require_admin

router = APIRouter()


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    rows = db.query(Setting).all()
    return {r.key: r.value for r in rows}


@router.put("/settings/{key}")
def update_setting(
    key: str,
    body: SettingUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    row = db.query(Setting).filter(Setting.key == key).first()
    if not row:
        row = Setting(key=key, value=body.value)
        db.add(row)
    else:
        row.value = body.value
    db.commit()
    return {"key": key, "value": body.value}
