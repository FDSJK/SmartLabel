import json
import os
import uuid


def _draft_path(work_dir: str, batch_name: str, file_name: str) -> str:
    stem = os.path.splitext(file_name)[0]
    return os.path.join(work_dir, "batches", batch_name, "drafts", f"{stem}.json")


def read_draft(work_dir: str, batch_name: str, file_name: str) -> dict | None:
    """读草稿 JSON；文件不存在返回 None。"""
    path = _draft_path(work_dir, batch_name, file_name)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_draft(work_dir: str, batch_name: str, file_name: str, draft: dict) -> dict:
    """原子写草稿 JSON，返回写入的 dict。"""
    path = _draft_path(work_dir, batch_name, file_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(draft, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    return draft


def delete_draft(work_dir: str, batch_name: str, file_name: str) -> None:
    """删除草稿 JSON（不存在则无操作）。"""
    path = _draft_path(work_dir, batch_name, file_name)
    if os.path.isfile(path):
        os.remove(path)
