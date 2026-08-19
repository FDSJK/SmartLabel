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


def vectorize_mask(mask_path: str, threshold: int = DEFAULT_THRESHOLD) -> list[dict]:
    """把一张二值 mask 图转成多边形列表，每个多边形为 {"points": 外环, "holes": [内环, ...]}。

    先转灰度、以 threshold 为界二值化（处理 JPG 有损压缩的边缘插值），
    再用 OpenCV 提取内外轮廓（RETR_CCOMP）并做多边形简化，把孔洞归到其外环下。
    """
    img = PILImage.open(mask_path).convert("L")
    arr = np.array(img, dtype=np.uint8)
    binary = (arr > threshold).astype(np.uint8) * 255

    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

    # 先对每个轮廓做简化 + 过滤，记录存活轮廓（原索引 -> pts）
    kept: dict[int, list[list[float]]] = {}
    for i, c in enumerate(contours):
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            continue
        peri = cv2.arcLength(c, True)
        epsilon = max(1.0, 0.005 * peri)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = [[float(p[0][0]), float(p[0][1])] for p in approx]
        if len(pts) >= 3:
            kept[i] = pts

    # RETR_CCOMP：外轮廓 parent == -1（level 0），孔 parent >= 0（level 1）
    polygons: list[dict] = []
    outer_by_idx: dict[int, dict] = {}
    for i, pts in kept.items():
        if hierarchy[0][i][3] == -1:
            outer_by_idx[i] = {"points": pts, "holes": []}
            polygons.append(outer_by_idx[i])

    for i, pts in kept.items():
        parent = hierarchy[0][i][3]
        if parent in outer_by_idx:  # 孔，挂到其外环下；孤孔（外环被过滤）丢弃
            outer_by_idx[parent]["holes"].append(pts)

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
            # 有 mask 文件但全黑为空 → 该标签在此图 absent
            result["label_status"][label_name] = "absent"
            continue

        _, created = _get_or_create_label(db, label_name)
        if created:
            result["created_labels"].append(label_name)

        for poly in polygons:
            result["shapes"].append({
                "id": str(uuid.uuid4()),
                "label": label_name,
                "shapeType": "polygon",
                "points": poly["points"],
                "holes": poly["holes"],
            })
        result["label_status"][label_name] = "present"

    result["imported"] = len(result["shapes"]) > 0
    return result


def _backfill_absent(work_dir: str, batch_name: str, file_name: str, data: dict) -> dict | None:
    """对已有标注的图补标：全黑 mask 且当前无 shapes、状态缺失或为 pending 的标签 → absent。

    只补「缺失/pending」的标签，不覆盖已有的 present/absent，也不动有 shapes 的标签。
    返回新的 labelStatus（若有变化），否则返回 None（无需写盘）。
    """
    masks_dir = os.path.join(work_dir, "batches", batch_name, "masks")
    if not os.path.isdir(masks_dir):
        return None
    stem = os.path.splitext(file_name)[0]
    existing_status = dict(data.get("labelStatus", {}))
    labels_with_shapes = {s.get("label") for s in data.get("shapes", [])}
    changed = False

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
        if label_name in labels_with_shapes:
            continue  # 有 shapes → present，不动
        if existing_status.get(label_name) not in (None, "pending"):
            continue  # 已有 present/absent，尊重现状
        try:
            polygons = vectorize_mask(mask_path)
        except Exception:
            continue
        if not polygons:
            existing_status[label_name] = "absent"
            changed = True

    return existing_status if changed else None


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
            # 已标注的图不重导 shapes，只补标全黑 mask 对应标签的 absent
            updated_status = _backfill_absent(work_dir, batch.name, image.file_name, data)
            if updated_status is not None:
                saved = write_annotation(
                    work_dir=work_dir,
                    batch_name=batch.name,
                    file_name=image.file_name,
                    shapes=data.get("shapes", []),
                    label_status=updated_status,
                    image_width=image.width,
                    image_height=image.height,
                    username=username,
                    current_version=data.get("version", 0),
                )
                image.annotation_rev = saved["version"]
            result["skipped"] += 1
            continue

        current_version = data.get("version", 0) if data else 0
        r = import_image_masks(work_dir, batch, image, db)
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
        if not r["imported"] and not r["label_status"]:
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


def import_all_batches(work_dir: str, db: Session, username: str = "system", created_by: int | None = None) -> dict:
    """对所有批次执行 mask 导入，聚合结果。"""
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}
    q = db.query(Batch)
    if created_by is not None:
        q = q.filter(Batch.created_by == created_by)
    for batch in q.all():
        r = import_batch_masks(work_dir, batch, db, username=username)
        result["imported"] += r["imported"]
        result["skipped"] += r["skipped"]
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
    return result
