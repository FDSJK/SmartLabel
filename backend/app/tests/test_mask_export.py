import os
import numpy as np
from PIL import Image as PILImage

from app.services.mask_export import shapes_to_masks, export_image_masks


def test_shapes_to_masks_solid_square():
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []}]
    masks = shapes_to_masks(shapes, {"cat": "present"}, 20, 20)
    assert set(masks) == {"cat"}
    assert masks["cat"][5, 5] == 255
    assert masks["cat"][15, 15] == 0


def test_shapes_to_masks_donut_hole():
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
               "holes": [[[5, 5], [15, 5], [15, 15], [5, 15]]]}]
    masks = shapes_to_masks(shapes, {"cat": "present"}, 20, 20)
    assert masks["cat"][2, 2] == 255     # 环内
    assert masks["cat"][10, 10] == 0     # 孔内
    assert masks["cat"][18, 18] == 255   # 环内


def test_shapes_to_masks_absent_black_and_pending_skipped():
    masks = shapes_to_masks([], {"cat": "absent", "dog": "pending"}, 10, 10)
    assert set(masks) == {"cat"}          # pending 跳过
    assert masks["cat"].max() == 0        # absent 全黑


def test_shapes_to_masks_two_labels():
    shapes = [
        {"label": "cat", "shapeType": "polygon", "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []},
        {"label": "dog", "shapeType": "polygon", "points": [[10, 10], [20, 10], [20, 20], [10, 20]], "holes": []},
    ]
    masks = shapes_to_masks(shapes, {"cat": "present", "dog": "present"}, 20, 20)
    assert set(masks) == {"cat", "dog"}
    assert masks["cat"][5, 5] == 255
    assert masks["dog"][15, 15] == 255
    assert masks["cat"][15, 15] == 0


def test_export_image_masks_writes_files(tmp_work_dir):
    from app.models.batch import Batch
    from app.models.image import Image
    batch = Batch(name="b1", source="upload")
    image = Image(batch_id=1, file_name="a.png", width=20, height=20, channels=3)
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []}]
    result = export_image_masks(tmp_work_dir, batch, image, shapes,
                                {"cat": "present", "dog": "absent"})
    assert result["saved"] == ["cat", "dog"]
    assert result["errors"] == []
    cat = np.array(PILImage.open(
        os.path.join(tmp_work_dir, "batches", "b1", "masks", "cat", "a.png")).convert("L"))
    dog = np.array(PILImage.open(
        os.path.join(tmp_work_dir, "batches", "b1", "masks", "dog", "a.png")).convert("L"))
    assert cat[5, 5] == 255
    assert dog.max() == 0


def test_export_roundtrip_donut(tmp_work_dir):
    from app.models.batch import Batch
    from app.models.image import Image
    from app.services.mask_import import vectorize_mask
    batch = Batch(name="b1", source="upload")
    image = Image(batch_id=1, file_name="a.png", width=40, height=40, channels=3)
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[5, 5], [35, 5], [35, 35], [5, 35]],
               "holes": [[[15, 15], [25, 15], [25, 25], [15, 25]]]}]
    export_image_masks(tmp_work_dir, batch, image, shapes, {"cat": "present"})
    path = os.path.join(tmp_work_dir, "batches", "b1", "masks", "cat", "a.png")
    polys = vectorize_mask(path)
    assert len(polys) == 1
    assert len(polys[0]["holes"]) == 1
