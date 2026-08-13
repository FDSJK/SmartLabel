import json
import os
import tempfile
import uuid
from datetime import datetime


def _annotation_path(work_dir: str, batch_name: str, file_name: str) -> str:
    """Return the sidecar JSON path for an image."""
    stem = os.path.splitext(file_name)[0]
    return os.path.join(work_dir, "batches", batch_name, "annotations", f"{stem}.json")


def read_annotation(work_dir: str, batch_name: str, file_name: str) -> dict | None:
    """Read annotation sidecar JSON. Returns None if file does not exist."""
    path = _annotation_path(work_dir, batch_name, file_name)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_annotation(
    work_dir: str,
    batch_name: str,
    file_name: str,
    shapes: list[dict],
    label_status: dict[str, str],
    image_width: int,
    image_height: int,
    username: str,
    current_version: int = 0,
) -> dict:
    """Atomically write annotation sidecar JSON. Returns the saved data dict."""
    path = _annotation_path(work_dir, batch_name, file_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    new_version = current_version + 1
    now = datetime.utcnow().isoformat() + "Z"

    data = {
        "schemaVersion": 1,
        "imageName": file_name,
        "imageWidth": image_width,
        "imageHeight": image_height,
        "shapes": shapes,
        "labelStatus": label_status,
        "version": new_version,
        "updatedBy": username,
        "updatedAt": now,
    }

    # Atomic write: write to temp file, then os.replace
    tmp_path = os.path.join(
        os.path.dirname(path),
        f".{os.path.basename(path)}.{uuid.uuid4().hex[:8]}.tmp",
    )
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    os.replace(tmp_path, path)
    return data
