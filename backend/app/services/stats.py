from app.models.batch import Batch
from app.models.image import Image
from app.models.label import Label
from app.services.annotation_store import read_annotation


def compute_stats(work_dir: str, db, batch_id: int | None = None, created_by: int | None = None) -> dict:
    """按启用标签统计 present/absent/pending 图像数。batch_id=None 为全局。

    返回 {"total_images": int, "labels": [{"name","present","absent","pending"}, ...]}
    """
    labels = db.query(Label).filter(Label.enabled.is_(True)).order_by(Label.sort_order, Label.id).all()
    q = db.query(Image).join(Batch, Image.batch_id == Batch.id)
    if created_by is not None:
        q = q.filter(Batch.created_by == created_by)
    if batch_id is not None:
        q = q.filter(Image.batch_id == batch_id)
    images = q.all()

    bq = db.query(Batch)
    if created_by is not None:
        bq = bq.filter(Batch.created_by == created_by)
    batch_names = {b.id: b.name for b in bq.all()}
    counts = {label.name: {"present": 0, "absent": 0, "pending": 0} for label in labels}

    for img in images:
        batch_name = batch_names.get(img.batch_id)
        if not batch_name:
            continue
        try:
            data = read_annotation(work_dir, batch_name, img.file_name)
        except (ValueError, OSError):
            data = None
        status = data.get("labelStatus", {}) if isinstance(data, dict) else {}
        if not isinstance(status, dict):
            status = {}
        for label in labels:
            v = status.get(label.name)
            if v == "present":
                counts[label.name]["present"] += 1
            elif v == "absent":
                counts[label.name]["absent"] += 1
            else:
                counts[label.name]["pending"] += 1

    return {
        "total_images": len(images),
        "labels": [{"name": l.name, **counts[l.name]} for l in labels],
    }
