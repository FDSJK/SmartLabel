import cv2
import numpy as np
from PIL import Image as PILImage

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
