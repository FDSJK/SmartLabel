import threading
import uuid
import cv2
import numpy as np
from PIL import Image as PILImage
import onnxruntime as ort

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
    """logits (1,C,H',W') → {label: 原图分辨率二值 mask(0/255)}。背景通道自然排除（不匹配任何 label channel）。"""
    logits = logits[0]  # (C, H', W')

    if cfg.postprocess == "argmax":
        class_map = logits.argmax(axis=0).astype(np.uint8)
        class_map = cv2.resize(class_map, (cfg.input_width, cfg.input_height),
                               interpolation=cv2.INTER_NEAREST)
        masks: dict[str, np.ndarray] = {}
        for cat in cfg.categories:
            masks[cat["label"]] = ((class_map == int(cat["channel"])) * 255).astype(np.uint8)
    else:  # sigmoid
        prob = 1.0 / (1.0 + np.exp(-logits))  # (C, H', W')
        masks = {}
        for cat in cfg.categories:
            p = cv2.resize(prob[int(cat["channel"])], (cfg.input_width, cfg.input_height),
                           interpolation=cv2.INTER_LINEAR)
            masks[cat["label"]] = ((p > cfg.sigmoid_threshold) * 255).astype(np.uint8)

    # 逆 resize 回原图分辨率（stretch：直接最近邻缩放）
    return {label: cv2.resize(m, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
            for label, m in masks.items()}


_sessions: dict[int, ort.InferenceSession] = {}
_session_lock = threading.Lock()
_infer_lock = threading.Lock()


def _get_session(cfg: ModelConfig) -> ort.InferenceSession:
    with _session_lock:
        if cfg.id not in _sessions:
            avail = ort.get_available_providers()
            providers = (["CUDAExecutionProvider", "CPUExecutionProvider"]
                         if "CUDAExecutionProvider" in avail else ["CPUExecutionProvider"])
            _sessions[cfg.id] = ort.InferenceSession(cfg.model_path, providers=providers)
        return _sessions[cfg.id]


def invalidate_session(cfg_id: int) -> None:
    with _session_lock:
        _sessions.pop(cfg_id, None)


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
                "points": poly["points"],
                "holes": poly["holes"],
            })
    return shapes
