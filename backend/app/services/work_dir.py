import app.core.config as _config
from app.models.setting import Setting


def get_work_dir(db, user) -> str:
    """当前用户的工作目录。解析顺序：user.work_dir → settings.WORK_DIR → env 默认。"""
    if user is not None and getattr(user, "work_dir", None):
        v = user.work_dir.strip()
        if v:
            return v
    row = db.query(Setting).filter(Setting.key == "WORK_DIR").first()
    if row and row.value.strip():
        return row.value.strip()
    return _config.settings.WORK_DIR
