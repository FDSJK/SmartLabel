# backend/app/services/exporter.py
import json
import os
from datetime import datetime

import numpy as np
from PIL import Image as PILImage
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.image import Image
from app.models.label import Label
from app.services.annotation_store import read_annotation
from app.services.mask_export import shapes_to_masks


# ---------- 几何 ----------

def _signed_area(points):
    n = len(points)
    s = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def _polygon_area(points):
    return abs(_signed_area(points))


def _normalize_outer(points):
    """外环归一化为逆时针（有向面积为正）。"""
    return points if _signed_area(points) > 0 else list(reversed(points))


def _normalize_hole(points):
    """孔洞归一化为顺时针（有向面积为负）。"""
    return points if _signed_area(points) < 0 else list(reversed(points))


def _flatten(points):
    out = []
    for x, y in points:
        out.extend([float(x), float(y)])
    return out


def _bbox_of(polys):
    xs = [p[0] for ring in polys for p in ring]
    ys = [p[1] for ring in polys for p in ring]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return [x0, y0, x1 - x0, y1 - y0]


# ---------- RLE ----------

def _mask_to_rle(mask):
    """二值掩码 → COCO 未压缩 RLE（列主序，背景开头，偶数条，以背景结尾）。"""
    h, w = mask.shape
    flat = (mask > 0).astype(np.uint8).flatten(order="F")
    counts = []
    prev = 0
    run = 0
    for v in flat:
        v = int(v)
        if v == prev:
            run += 1
        else:
            counts.append(run)
            prev = v
            run = 1
    counts.append(run)
    if prev == 1 or len(counts) % 2 == 1:
        counts.append(0)
    return {"counts": counts, "size": [h, w]}


# ---------- 范围与读取 ----------

def _resolve_scope(db, scope, image_id, batch_id):
    labels = db.query(Label).filter(Label.enabled.is_(True)).order_by(Label.sort_order, Label.id).all()
    if scope == "image":
        img = db.query(Image).filter(Image.id == image_id).first()
        images = [img] if img else []
    elif scope == "batch":
        images = db.query(Image).filter(Image.batch_id == batch_id).all()
    else:
        images = db.query(Image).all()
    return images, labels


def _load_items(work_dir, db, images):
    batch_names = {b.id: b.name for b in db.query(Batch).all()}
    items = []
    errors = []
    for img in images:
        batch_name = batch_names.get(img.batch_id)
        if not batch_name:
            errors.append({"file": img.file_name, "error": "batch not found"})
            continue
        try:
            data = read_annotation(work_dir, batch_name, img.file_name)
        except (json.JSONDecodeError, OSError) as e:
            errors.append({"file": img.file_name, "error": f"corrupt annotation: {e}"})
            continue
        items.append((img, data))
    return items, errors


def collect_scope(work_dir, db, scope, image_id, batch_id):
    images, labels = _resolve_scope(db, scope, image_id, batch_id)
    items, errors = _load_items(work_dir, db, images)
    return {"images": images, "labels": labels, "items": items, "errors": errors}


def compute_pending(items, labels):
    pending = []
    for img, data in items:
        status = (data or {}).get("labelStatus", {})
        miss = [l.name for l in labels if status.get(l.name) not in ("present", "absent")]
        if miss:
            pending.append({"image": img.file_name, "labels": miss})
    return pending


# ---------- 格式构建 ----------

def _build_coco(items, labels):
    images = []
    annotations = []
    categories = [{"id": l.id, "name": l.name, "supercategory": ""} for l in labels]
    ann_id = 0
    for img, data in items:
        images.append({"id": img.id, "file_name": img.file_name,
                       "width": img.width, "height": img.height})
        shapes = (data or {}).get("shapes", [])
        by_label = {}
        for s in shapes:
            by_label.setdefault(s.get("label"), []).append(s)
        for label in labels:
            ann_shapes = by_label.get(label.name, [])
            if not ann_shapes:
                continue
            seg = []
            outer_polys = []
            area = 0.0
            for s in ann_shapes:
                outer = _normalize_outer(s["points"])
                outer_polys.append(outer)
                seg.append(_flatten(outer))
                area += _polygon_area(outer)
                for hole in s.get("holes", []):
                    seg.append(_flatten(_normalize_hole(hole)))
                    area -= _polygon_area(hole)
            area = max(area, 0.0)
            masks = shapes_to_masks(ann_shapes, {label.name: "present"}, img.width, img.height)
            rle = _mask_to_rle(masks[label.name])
            ann_id += 1
            annotations.append({
                "id": ann_id,
                "image_id": img.id,
                "category_id": label.id,
                "segmentation": seg,
                "segmentation_rle": rle,
                "area": area,
                "bbox": _bbox_of(outer_polys),
                "iscrowd": 0,
            })
    return {"images": images, "annotations": annotations, "categories": categories}


def _build_labelme(img, data):
    shapes = []
    for s in (data or {}).get("shapes", []):
        shapes.append({
            "label": s.get("label"),
            "points": [[float(x), float(y)] for x, y in s["points"]],
            "group_id": None,
            "shape_type": "polygon",
            "flags": {},
        })
        for hole in s.get("holes", []):
            shapes.append({
                "label": "_background_",
                "points": [[float(x), float(y)] for x, y in hole],
                "group_id": None,
                "shape_type": "polygon",
                "flags": {},
            })
    return {
        "version": "5.2.1",
        "flags": {},
        "shapes": shapes,
        "imagePath": img.file_name,
        "imageData": None,
        "imageHeight": img.height,
        "imageWidth": img.width,
        "labelStatus": (data or {}).get("labelStatus", {}),
    }


# ---------- 生成 ----------

def _scope_name(db, scope, image_id, batch_id, images):
    if scope == "image":
        return f"image-{os.path.splitext(images[0].file_name)[0]}"
    if scope == "batch":
        batch = db.query(Batch).filter(Batch.id == batch_id).first()
        return f"batch-{batch.name if batch else 'unknown'}"
    return "all"


def generate_export(work_dir, db, *, scope, image_id, batch_id, collected, formats, username="system"):
    images = collected["images"]
    labels = collected["labels"]
    items = collected["items"]
    errors = list(collected["errors"])

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    export_dir = os.path.join(work_dir, "export", f"{stamp}-{_scope_name(db, scope, image_id, batch_id, images)}")

    annotation_count = 0
    mask_count = 0

    if "mask" in formats:
        root = os.path.join(export_dir, "masks")
        for img, data in items:
            masks = shapes_to_masks((data or {}).get("shapes", []),
                                    (data or {}).get("labelStatus", {}),
                                    img.width, img.height)
            stem = os.path.splitext(img.file_name)[0]
            for label, arr in masks.items():
                subdir = os.path.join(root, label)
                os.makedirs(subdir, exist_ok=True)
                PILImage.fromarray(arr).save(os.path.join(subdir, f"{stem}.png"))
                mask_count += 1

    if "labelme" in formats:
        root = os.path.join(export_dir, "labelme")
        os.makedirs(root, exist_ok=True)
        for img, data in items:
            stem = os.path.splitext(img.file_name)[0]
            with open(os.path.join(root, f"{stem}.json"), "w", encoding="utf-8") as f:
                json.dump(_build_labelme(img, data), f, ensure_ascii=False, indent=2)

    if "coco" in formats:
        root = os.path.join(export_dir, "coco")
        os.makedirs(root, exist_ok=True)
        doc = _build_coco(items, labels)
        annotation_count = len(doc["annotations"])
        with open(os.path.join(root, "annotations.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)

    return {
        "export_dir": os.path.relpath(export_dir, work_dir),
        "image_count": len(items),
        "annotation_count": annotation_count,
        "mask_count": mask_count,
        "errors": errors,
    }


def run_export(work_dir, db, *, scope, image_id, batch_id, formats, username="system"):
    collected = collect_scope(work_dir, db, scope, image_id, batch_id)
    return generate_export(work_dir, db, scope=scope, image_id=image_id, batch_id=batch_id,
                           collected=collected, formats=formats, username=username)
