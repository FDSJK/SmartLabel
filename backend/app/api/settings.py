import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.setting import Setting
from app.models.user import User
from app.models.batch import Batch
from app.models.image import Image
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

    # 改全局工作目录后，清理数据库里在新目录下已不存在的批次（含其图像）
    if key == "WORK_DIR":
        batches_dir = os.path.join(body.value, "batches")
        for batch in db.query(Batch).all():
            if not os.path.isdir(os.path.join(batches_dir, batch.name)):
                db.query(Image).filter(Image.batch_id == batch.id).delete()
                db.delete(batch)

    db.commit()
    return {"key": key, "value": body.value}
