import cv2
import numpy as np


def read_image(path: str) -> np.ndarray | None:
    """读取图像，兼容 Windows 下非 ASCII（如中文）路径。

    cv2.imread 在 Windows 上无法打开含中文的路径，这里改用
    np.fromfile 读入字节流 + cv2.imdecode 解码，避免该问题。
    """
    try:
        data = np.fromfile(path, dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    except Exception:
        return None


def enhance_clahe(img: np.ndarray, clip: float = 2.0, tile: int = 8) -> np.ndarray:
    """CLAHE 对比度受限自适应直方图均衡。

    只在亮度通道（LAB 的 L）上做自适应直方图均衡，再拼回 a/b 颜色通道，
    从而在增强局部对比度的同时避免颜色失真。灰度图直接对单通道做 CLAHE。
    """
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(tile, tile))

    if img.ndim == 2:
        return clahe.apply(img)

    if img.shape[2] == 4:
        # 保留 alpha 通道，仅增强 RGB 部分
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
        return np.dstack([enhance_clahe(bgr, clip, tile), alpha])

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
