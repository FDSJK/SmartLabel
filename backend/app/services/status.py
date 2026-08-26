from sqlalchemy.orm import Session
from app.models.label import Label


def derive_image_status(db: Session, label_status: dict[str, str]) -> str:
    """根据所有启用标签的状态推导图像状态。

    全部启用标签都已有明确状态（present/absent，即非 pending）则为 done，
    否则为 in_progress。没有任何启用标签时视为 in_progress。
    """
    enabled = [l.name for l in db.query(Label).filter(Label.enabled == True).all()]
    if not enabled:
        return "in_progress"
    all_resolved = all(label_status.get(name, "pending") != "pending" for name in enabled)
    return "done" if all_resolved else "in_progress"
