import json
import os
import uuid
import cv2
import numpy as np
from PIL import Image as PILImage
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.image import Image
from app.models.label import Label
from app.services.annotation_store import read_annotation, write_annotation
from app.services.image_processor import get_image_info

MASK_EXTENSIONS = (".png", ".jpg", ".jpeg")
MIN_CONTOUR_AREA = 4.0
DEFAULT_THRESHOLD = 128


def vectorize_mask(mask_path: str, threshold: int = DEFAULT_THRESHOLD) -> list[list[list[float]]]:
    """把一张二值 mask 图转成多边形列表。每个多边形为 [[x, y], ...]。

    先转灰度、以 threshold 为界二值化（处理 JPG 有损压缩的边缘插值），
    再用 OpenCV 提取外轮廓并做多边形简化。
    """
    img = PILImage.open(mask_path).convert("L")
    arr = np.array(img, dtype=np.uint8)
    binary = (arr > threshold).astype(np.uint8) * 255

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons: list[list[list[float]]] = []
    for c in contours:
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            continue
        peri = cv2.arcLength(c, True)
        epsilon = max(1.0, 0.005 * peri)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = [[float(p[0][0]), float(p[0][1])] for p in approx]
        if len(pts) >= 3:
            polygons.append(pts)
    return polygons


def _get_or_create_label(db: Session, name: str) -> tuple[Label, bool]:
    label = db.query(Label).filter(Label.name == name).first()
    if label:
        return label, False
    from app.api.labels import _next_color
    max_order = db.query(Label).order_by(Label.sort_order.desc()).first()
    label = Label(
        name=name,
        color=_next_color(db),
        sort_order=(max_order.sort_order + 1) if max_order else 0,
    )
    db.add(label)
    db.flush()
    return label, True


def import_image_masks(work_dir: str, batch: Batch, image: Image, db: Session) -> dict:
    """为单张空标注图像导入 mask。返回 {imported, shapes, label_status, errors, created_labels}。"""
    result = {"imported": False, "shapes": [], "label_status": {},
              "errors": [], "created_labels": []}

    masks_dir = os.path.join(work_dir, "batches", batch.name, "masks")
    if not os.path.isdir(masks_dir):
        return result

    stem = os.path.splitext(image.file_name)[0]

    for label_name in sorted(os.listdir(masks_dir)):
        subdir = os.path.join(masks_dir, label_name)
        if not os.path.isdir(subdir):
            continue

        mask_path = None
        for ext in MASK_EXTENSIONS:
            candidate = os.path.join(subdir, stem + ext)
            if os.path.isfile(candidate):
                mask_path = candidate
                break
        if mask_path is None:
            continue

        rel = os.path.relpath(mask_path, start=work_dir)
        try:
            info = get_image_info(mask_path)
        except Exception as e:
            result["errors"].append({"file": rel, "error": str(e)})
            continue
        if info["width"] != image.width or info["height"] != image.height:
            result["errors"].append({"file": rel, "error": "size mismatch"})
            continue

        try:
            polygons = vectorize_mask(mask_path)
        except Exception as e:
            result["errors"].append({"file": rel, "error": str(e)})
            continue
        if not polygons:
            continue

        _, created = _get_or_create_label(db, label_name)
        if created:
            result["created_labels"].append(label_name)

        for pts in polygons:
            result["shapes"].append({
                "id": str(uuid.uuid4()),
                "label": label_name,
                "shapeType": "polygon",
                "points": pts,
            })
        result["label_status"][label_name] = "present"

    result["imported"] = len(result["shapes"]) > 0
    return result


def import_batch_masks(work_dir: str, batch: Batch, db: Session, username: str = "system") -> dict:
    """为批次中所有空标注图像导入 mask，写 sidecar JSON 并同步 annotation_rev。"""
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}

    images = db.query(Image).filter(Image.batch_id == batch.id).all()
    for image in images:
        try:
            data = read_annotation(work_dir, batch.name, image.file_name)
        except (json.JSONDecodeError, OSError) as e:
            result["errors"].append({"file": image.file_name, "error": f"corrupt annotation: {e}"})
            result["skipped"] += 1
            continue
        if data and data.get("shapes"):
            result["skipped"] += 1
            continue

        current_version = data.get("version", 0) if data else 0
        r = import_image_masks(work_dir, batch, image, db)
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
        if not r["imported"]:
            continue

        existing_status = data.get("labelStatus", {}) if data else {}
        saved = write_annotation(
            work_dir=work_dir,
            batch_name=batch.name,
            file_name=image.file_name,
            shapes=r["shapes"],
            label_status={**existing_status, **r["label_status"]},
            image_width=image.width,
            image_height=image.height,
            username=username,
            current_version=current_version,
        )
        image.annotation_rev = saved["version"]
        result["imported"] += 1

    db.commit()
    return result


def import_all_batches(work_dir: str, db: Session, username: str = "system") -> dict:
    """对所有批次执行 mask 导入，聚合结果。"""
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}
    for batch in db.query(Batch).all():
        r = import_batch_masks(work_dir, batch, db, username=username)
        result["imported"] += r["imported"]
        result["skipped"] += r["skipped"]
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
    return result
