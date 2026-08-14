import os
import cv2
import numpy as np
from PIL import Image as PILImage


def shapes_to_masks(
    shapes: list[dict],
    label_status: dict[str, str],
    width: int,
    height: int,
) -> dict[str, np.ndarray]:
    """按标签状态把 shapes 栅格化成 {标签名: uint8 二值图}。

    present → 填外环 + 挖孔；absent → 全黑；pending → 跳过。
    """
    masks: dict[str, np.ndarray] = {}
    for label, status in label_status.items():
        if status in ("present", "absent"):
            masks[label] = np.zeros((height, width), dtype=np.uint8)

    # 第一遍：填外环
    for shape in shapes:
        label = shape.get("label")
        if label_status.get(label) != "present":
            continue
        outer = np.array(shape["points"], dtype=np.int32)
        if len(outer) >= 3:
            cv2.fillPoly(masks[label], [outer], 255)

    # 第二遍：挖孔（保证孔压过填充，与遍历顺序无关）
    for shape in shapes:
        label = shape.get("label")
        if label_status.get(label) != "present":
            continue
        for hole in shape.get("holes", []):
            inner = np.array(hole, dtype=np.int32)
            if len(inner) >= 3:
                cv2.fillPoly(masks[label], [inner], 0)

    return masks


def export_image_masks(
    work_dir: str,
    batch,
    image,
    shapes: list[dict],
    label_status: dict[str, str],
) -> dict:
    """把单张图的标注按标签写成 masks/<标签>/<原图名>.png。返回 {saved, errors}。"""
    masks = shapes_to_masks(shapes, label_status, image.width, image.height)
    stem = os.path.splitext(image.file_name)[0]
    saved: list[str] = []
    errors: list[dict] = []
    for label, mask_arr in masks.items():
        subdir = os.path.join(work_dir, "batches", batch.name, "masks", label)
        try:
            os.makedirs(subdir, exist_ok=True)
            path = os.path.join(subdir, stem + ".png")
            PILImage.fromarray(mask_arr).save(path)
            saved.append(label)
        except OSError as e:
            errors.append({"label": label, "error": str(e)})
    return {"saved": sorted(saved), "errors": errors}
