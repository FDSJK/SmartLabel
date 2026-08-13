import numpy as np
from PIL import Image as PILImage
from app.services.mask_import import vectorize_mask


def _write_mask(tmp_path, name, arr):
    p = tmp_path / name
    PILImage.fromarray(arr).save(str(p))
    return str(p)


def test_vectorize_rectangle(tmp_path):
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[20:80, 20:80] = 255
    path = _write_mask(tmp_path, "rect.png", arr)
    polys = vectorize_mask(path)
    assert len(polys) == 1
    xs = [p[0] for p in polys[0]]
    ys = [p[1] for p in polys[0]]
    assert 18 <= min(xs) <= 22 and 78 <= max(xs) <= 82
    assert 18 <= min(ys) <= 22 and 78 <= max(ys) <= 82


def test_vectorize_thresholds_gradient(tmp_path):
    # 左半 100（应判为背景），右半 200（应判为前景）
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[:, :50] = 100
    arr[:, 50:] = 200
    path = _write_mask(tmp_path, "grad.png", arr)
    polys = vectorize_mask(path)
    assert len(polys) == 1
    xs = [p[0] for p in polys[0]]
    assert min(xs) >= 49 and max(xs) <= 100  # 只有右半是前景


def test_vectorize_jpg_handles_interpolation(tmp_path):
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[30:70, 30:70] = 255
    p = tmp_path / "block.jpg"
    PILImage.fromarray(arr).save(str(p), quality=85)  # JPG 有损 → 边缘插值
    polys = vectorize_mask(str(p))
    assert len(polys) >= 1
    xs = [pt[0] for pt in polys[0]]
    assert 25 <= min(xs) <= 35 and 65 <= max(xs) <= 75
