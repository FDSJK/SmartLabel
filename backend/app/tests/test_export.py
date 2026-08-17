# backend/app/tests/test_export.py
import json
import os
from types import SimpleNamespace

import numpy as np
from PIL import Image as PILImage

from app.services.exporter import (
    _signed_area, _normalize_outer, _normalize_hole, _mask_to_rle,
    _build_coco, _build_labelme, compute_pending,
)


def _img(id, name, w=20, h=20):
    return SimpleNamespace(id=id, file_name=name, width=w, height=h, batch_id=1)


def _label(id, name):
    return SimpleNamespace(id=id, name=name)


def _decode_rle(rle):
    h, w = rle["size"]
    flat = np.empty(h * w, dtype=np.uint8)
    idx = 0
    val = 0
    for c in rle["counts"]:
        flat[idx:idx + c] = val
        idx += c
        val = 1 - val
    return flat.reshape((h, w), order="F")


def test_normalize_winding():
    ccw = [[0, 0], [10, 0], [10, 10], [0, 10]]       # 有向面积正
    cw = [[0, 0], [0, 10], [10, 10], [10, 0]]         # 有向面积负
    assert _signed_area(ccw) > 0
    assert _signed_area(cw) < 0
    assert _signed_area(_normalize_outer(cw)) > 0     # 反转后为正
    assert _signed_area(_normalize_hole(ccw)) < 0     # 反转后为负


def test_mask_to_rle_roundtrip():
    mask = np.zeros((10, 12), dtype=np.uint8)
    mask[2:8, 3:9] = 255
    mask[4:6, 5:7] = 0
    rle = _mask_to_rle(mask)
    assert rle["size"] == [10, 12]
    assert len(rle["counts"]) % 2 == 0
    assert np.array_equal(_decode_rle(rle), (mask > 0).astype(np.uint8))


def test_build_coco_donut():
    img = _img(1, "a.png")
    labels = [_label(1, "cat")]
    donut = {"id": "s1", "label": "cat", "shapeType": "polygon",
             "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
             "holes": [[[5, 5], [15, 5], [15, 15], [5, 15]]]}
    doc = _build_coco([(img, {"shapes": [donut], "labelStatus": {"cat": "present"}})], labels)
    assert doc["categories"] == [{"id": 1, "name": "cat", "supercategory": ""}]
    assert doc["images"] == [{"id": 1, "file_name": "a.png", "width": 20, "height": 20}]
    ann = doc["annotations"][0]
    assert len(ann["segmentation"]) == 2        # 外环 + 孔洞
    assert ann["area"] == 400.0 - 100.0         # 20*20 - 10*10
    assert ann["bbox"] == [0, 0, 20, 20]
    assert ann["iscrowd"] == 0
    # RLE 精确：孔洞中心为背景
    m = _decode_rle(ann["segmentation_rle"])
    assert m[10, 10] == 0
    assert m[2, 2] == 1


def test_build_labelme_hole_as_background():
    img = _img(1, "a.png")
    donut = {"id": "s1", "label": "cat", "shapeType": "polygon",
             "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
             "holes": [[[5, 5], [15, 5], [15, 15], [5, 15]]]}
    doc = _build_labelme(img, {"shapes": [donut], "labelStatus": {"cat": "present"}})
    assert len(doc["shapes"]) == 2
    assert doc["shapes"][0]["label"] == "cat"
    assert doc["shapes"][1]["label"] == "_background_"
    assert doc["labelStatus"] == {"cat": "present"}


def test_compute_pending():
    labels = [_label(1, "cat"), _label(2, "dog")]
    items = [(_img(1, "a.png"), {"labelStatus": {"cat": "present", "dog": "pending"}}),
             (_img(2, "b.png"), {"labelStatus": {}})]
    pending = compute_pending(items, labels)
    assert pending == [
        {"image": "a.png", "labels": ["dog"]},
        {"image": "b.png", "labels": ["cat", "dog"]},
    ]


def test_generate_export_masks(client, tmp_work_dir):
    from app.main import app
    from app.core.db import get_db
    from app.models.batch import Batch
    from app.models.image import Image
    from app.models.label import Label
    from app.services.exporter import collect_scope, generate_export

    db = next(app.dependency_overrides[get_db]())
    db.add(Batch(name="b1", source="upload"))
    db.commit()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    db.add(Image(batch_id=batch.id, file_name="a.png",
                 src_rel_path="batches/b1/images/a.png", width=20, height=20, channels=3))
    db.add(Label(name="cat", color="#f00", sort_order=0))
    db.add(Label(name="dog", color="#0f0", sort_order=1))
    db.commit()

    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        json.dump({
            "version": 1,
            "shapes": [{"id": "s1", "label": "cat", "shapeType": "polygon",
                        "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []}],
            "labelStatus": {"cat": "present", "dog": "absent", "bird": "pending"},
        }, f)

    collected = collect_scope(tmp_work_dir, db, "batch", None, batch.id)
    result = generate_export(tmp_work_dir, db, scope="batch", image_id=None, batch_id=batch.id,
                             collected=collected, formats=["mask"])
    db.close()

    assert result["image_count"] == 1
    assert result["mask_count"] == 2                      # cat + dog；bird pending 跳过
    masks_dir = os.path.join(tmp_work_dir, result["export_dir"], "masks")
    assert os.path.isfile(os.path.join(masks_dir, "cat", "a.png"))
    assert os.path.isfile(os.path.join(masks_dir, "dog", "a.png"))
    assert not os.path.isfile(os.path.join(masks_dir, "bird", "a.png"))
    cat = np.array(PILImage.open(os.path.join(masks_dir, "cat", "a.png")).convert("L"))
    dog = np.array(PILImage.open(os.path.join(masks_dir, "dog", "a.png")).convert("L"))
    assert cat[5, 5] == 255
    assert dog.max() == 0
