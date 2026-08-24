import os
import threading
import uuid
import cv2
import numpy as np
from PIL import Image as PILImage
import onnxruntime as ort
import app.core.config as _config

from app.models.model_config import ModelConfig
from app.services.mask_import import vectorize_array


def preprocess(image_path: str, cfg: ModelConfig) -> tuple[np.ndarray, int, int]:
    """返回 (tensor, orig_w, orig_h)，tensor 形状 (1,3,H,W) float32。"""
    if cfg.resize_mode == "letterbox":
        raise NotImplementedError("letterbox resize is not yet supported")

    img = PILImage.open(image_path).convert("RGB")
    orig_w, orig_h = img.size  # PIL 是 (width, height)
    arr = np.array(img)  # (H, W, 3) uint8

    # stretch: 直接缩放（对齐 test_UWF.py 的 cv2.resize INTER_CUBIC）
    arr = cv2.resize(arr, (cfg.input_width, cfg.input_height), interpolation=cv2.INTER_CUBIC)

    arr = arr.astype(np.float32)
    if cfg.normalize_mode == "min_max":
        mn = arr.min(axis=(0, 1), keepdims=True)
        mx = arr.max(axis=(0, 1), keepdims=True)
        arr = (arr - mn) / (mx - mn + 1e-8)
    elif cfg.normalize_mode == "mean_std":
        mean = np.array(cfg.mean or [0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
        std = np.array(cfg.std or [0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)
        arr = (arr / 255.0 - mean) / std
    # none: 保持 [0,255] float32

    tensor = arr.transpose(2, 0, 1)[None, ...].astype(np.float32)  # (1,3,H,W)
    return tensor, orig_w, orig_h


def postprocess(logits: np.ndarray, cfg: ModelConfig, orig_w: int, orig_h: int) -> dict[str, np.ndarray]:
    """logits (1,C,H',W') → {label: 原图分辨率二值 mask(0/255)}。

    先把 logits 双线性上采样到原图尺寸再做 argmax/阈值，避免最近邻放大产生的锯齿边界。
    背景通道自然排除（不匹配任何 label channel）。
    """
    logits = logits[0]  # (C, H', W')
    hwc = logits.transpose(1, 2, 0)  # (H', W', C)
    up = cv2.resize(hwc, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)  # (H, W, C)

    masks: dict[str, np.ndarray] = {}
    if cfg.postprocess == "argmax":
        class_map = up.argmax(axis=2).astype(np.uint8)  # (H, W)
        for cat in cfg.categories:
            masks[cat["label"]] = ((class_map == int(cat["channel"])) * 255).astype(np.uint8)
    else:  # sigmoid
        prob = 1.0 / (1.0 + np.exp(-up))  # (H, W, C)
        for cat in cfg.categories:
            masks[cat["label"]] = ((prob[..., int(cat["channel"])] > cfg.sigmoid_threshold) * 255).astype(np.uint8)
    return masks


_sessions: dict[int, ort.InferenceSession] = {}
_session_lock = threading.Lock()
_infer_lock = threading.Lock()


def _resolve_model_path(cfg: ModelConfig) -> str:
    """source=upload 时 model_path 是文件名，拼上 MODELS_DIR；source=path 时已是完整路径。"""
    if cfg.source == "upload":
        return os.path.join(_config.settings.MODELS_DIR, cfg.model_path)
    return cfg.model_path


def _get_session(cfg: ModelConfig) -> ort.InferenceSession:
    with _session_lock:
        if cfg.id not in _sessions:
            avail = ort.get_available_providers()
            providers = (["CUDAExecutionProvider", "CPUExecutionProvider"]
                         if "CUDAExecutionProvider" in avail else ["CPUExecutionProvider"])
            _sessions[cfg.id] = ort.InferenceSession(_resolve_model_path(cfg), providers=providers)
        return _sessions[cfg.id]


def invalidate_session(cfg_id: int) -> None:
    with _session_lock:
        _sessions.pop(cfg_id, None)


def _smooth_ring(pts: list[list[float]], iterations: int = 2) -> list[list[float]]:
    """Chaikin 角切法平滑环，减少像素级锯齿。"""
    for _ in range(iterations):
        n = len(pts)
        if n < 3:
            break
        smoothed: list[list[float]] = []
        for i in range(n):
            p0 = pts[i]
            p1 = pts[(i + 1) % n]
            smoothed.append([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
            smoothed.append([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
        pts = smoothed
    return pts


def _simplify_ring(pts: list[list[float]], epsilon: float) -> list[list[float]]:
    """Douglas-Peucker 简化，去掉平滑后产生的冗余点。"""
    if len(pts) < 4:
        return pts
    arr = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
    approx = cv2.approxPolyDP(arr, epsilon, True)
    out = [[float(p[0][0]), float(p[0][1])] for p in approx]
    return out if len(out) >= 3 else pts


def _smooth_and_simplify(pts: list[list[float]]) -> list[list[float]]:
    """先 Chaikin 平滑锯齿，再 Douglas-Peucker 简化，得到平滑且点数适中的环。"""
    smoothed = _smooth_ring(pts, iterations=2)
    peri = cv2.arcLength(np.array(smoothed, dtype=np.float32).reshape(-1, 1, 2), True)
    return _simplify_ring(smoothed, max(1.0, 0.005 * peri))


def run_inference(cfg: ModelConfig, image_path: str) -> list[dict]:
    tensor, orig_w, orig_h = preprocess(image_path, cfg)
    with _infer_lock:  # CPU 串行化
        session = _get_session(cfg)
        out = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    masks = postprocess(out, cfg, orig_w, orig_h)

    shapes: list[dict] = []
    for cat in cfg.categories:
        label = cat["label"]
        if label not in masks:
            continue
        for poly in vectorize_array(masks[label]):
            shapes.append({
                "id": str(uuid.uuid4()),
                "label": label,
                "shapeType": "polygon",
                "points": _smooth_and_simplify(poly["points"]),
                "holes": [_smooth_and_simplify(h) for h in poly["holes"]],
            })
    return shapes
