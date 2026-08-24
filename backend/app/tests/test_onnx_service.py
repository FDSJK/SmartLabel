import numpy as np
from app.models.model_config import ModelConfig


def _cfg(**kw) -> ModelConfig:
    base = dict(
        id=1, name="t", source="path", model_path="/x.onnx",
        input_width=4, input_height=4, resize_mode="stretch", normalize_mode="min_max",
        mean=None, std=None, background_channel=0,
        categories=[{"label": "cat", "channel": 1}], postprocess="argmax",
        sigmoid_threshold=0.5, enabled=True,
    )
    base.update(kw)
    return ModelConfig(**base)


def _write_img(path, w, h):
    import os
    from PIL import Image as PILImage
    os.makedirs(os.path.dirname(path), exist_ok=True)
    PILImage.fromarray(np.zeros((h, w, 3), dtype=np.uint8)).save(path)


def test_preprocess_minmax_shape_and_range(tmp_path):
    from app.services.onnx_service import preprocess
    p = str(tmp_path / "a.png"); _write_img(p, 8, 8)
    tensor, ow, oh = preprocess(p, _cfg(input_width=8, input_height=8))
    assert tensor.shape == (1, 3, 8, 8)
    assert (ow, oh) == (8, 8)
    assert float(tensor.min()) >= 0.0 and float(tensor.max()) <= 1.0


def test_postprocess_argmax_maps_back_and_excludes_background():
    from app.services.onnx_service import postprocess
    logits = np.zeros((1, 2, 4, 4), dtype=np.float32)
    logits[:, 1, :, :] = 1.0  # 全为 cat（channel 1），channel 0 = 背景
    masks = postprocess(logits, _cfg(), orig_w=8, orig_h=8)
    assert set(masks.keys()) == {"cat"}
    assert masks["cat"].shape == (8, 8)
    assert masks["cat"].max() == 255


def test_postprocess_sigmoid_threshold():
    from app.services.onnx_service import postprocess
    cfg = _cfg(postprocess="sigmoid", sigmoid_threshold=0.5)
    logits = np.zeros((1, 2, 4, 4), dtype=np.float32)
    logits[:, 1, 0:2, :] = 2.0   # sigmoid(2)≈0.88 > 0.5
    logits[:, 1, 2:4, :] = -2.0  # sigmoid(-2)≈0.12 < 0.5
    masks = postprocess(logits, cfg, orig_w=4, orig_h=4)
    assert masks["cat"].shape == (4, 4)
    assert masks["cat"][0:2, :].min() == 255
    assert masks["cat"][2:4, :].max() == 0


def test_run_inference_pipeline(monkeypatch, tmp_path):
    from app.services import onnx_service
    from app.services.onnx_service import run_inference
    p = str(tmp_path / "a.png"); _write_img(p, 16, 16)

    class FakeSession:
        def get_inputs(self):
            class I:
                name = "input"
            return [I()]
        def run(self, _none, feed):
            logits = np.zeros((1, 2, 4, 4), dtype=np.float32)
            logits[:, 1, :, :] = 1.0  # 全前景 → 矢量化出一个大矩形
            return [logits]

    monkeypatch.setattr(onnx_service, "_get_session", lambda cfg: FakeSession())
    shapes = run_inference(_cfg(), p)
    assert len(shapes) == 1
    assert shapes[0]["label"] == "cat"
    assert len(shapes[0]["points"]) >= 3


def test_resolve_model_path(monkeypatch, tmp_path):
    import os
    from app.services.onnx_service import _resolve_model_path
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", str(tmp_path))
    assert _resolve_model_path(_cfg(source="upload", model_path="m.onnx")) == os.path.join(str(tmp_path), "m.onnx")
    assert _resolve_model_path(_cfg(source="path", model_path="/abs/m.onnx")) == "/abs/m.onnx"
