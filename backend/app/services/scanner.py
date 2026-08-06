import os
import json
from sqlalchemy.orm import Session
from app.models.batch import Batch
from app.models.image import Image
from app.services.image_processor import get_image_info, convert_to_rgb, SUPPORTED_EXTENSIONS


def scan_batches(work_dir: str, db: Session, created_by: int | None = None) -> dict:
    """Scan batches/*/images/ for new images. Returns {added, skipped, errors}."""
    batches_dir = os.path.join(work_dir, "batches")
    if not os.path.isdir(batches_dir):
        return {"added": 0, "skipped": 0, "errors": []}

    result = {"added": 0, "skipped": 0, "errors": []}

    for batch_name in sorted(os.listdir(batches_dir)):
        batch_path = os.path.join(batches_dir, batch_name)
        images_dir = os.path.join(batch_path, "images")
        if not os.path.isdir(images_dir):
            continue

        batch = db.query(Batch).filter(Batch.name == batch_name).first()
        if not batch:
            batch = Batch(name=batch_name, source="scan", created_by=created_by)
            db.add(batch)
            db.flush()

        for fname in sorted(os.listdir(images_dir)):
            fpath = os.path.join(images_dir, fname)
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            if not os.path.isfile(fpath):
                continue

            src_rel = os.path.relpath(fpath, start=work_dir)

            existing = db.query(Image).filter(
                Image.batch_id == batch.id, Image.file_name == fname
            ).first()
            if existing:
                result["skipped"] += 1
                continue

            try:
                info = get_image_info(fpath)
            except Exception as e:
                result["errors"].append({"file": src_rel, "error": str(e)})
                continue

            work_rel = None
            if info["channels"] > 3:
                cache_dir = os.path.join(batch_path, "cache", "rgb")
                os.makedirs(cache_dir, exist_ok=True)
                try:
                    work_rel = convert_to_rgb(fpath, cache_dir)
                except Exception as e:
                    result["errors"].append({"file": src_rel, "error": f"RGB conversion failed: {e}"})
                    continue

            image = Image(
                batch_id=batch.id,
                file_name=fname,
                src_rel_path=src_rel,
                work_rel_path=work_rel,
                width=info["width"],
                height=info["height"],
                channels=min(info["channels"], 3),
                status="pending",
            )

            # Check for existing sidecar JSON
            annot_dir = os.path.join(batch_path, "annotations")
            json_name = os.path.splitext(fname)[0] + ".json"
            json_path = os.path.join(annot_dir, json_name)
            if os.path.isfile(json_path):
                try:
                    with open(json_path, "r") as f:
                        annot = json.load(f)
                    image.annotation_rev = annot.get("version", 0)
                except Exception:
                    pass

            db.add(image)
            result["added"] += 1

    db.commit()
    return result
