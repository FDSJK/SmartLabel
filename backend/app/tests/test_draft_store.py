def test_draft_roundtrip(tmp_work_dir):
    from app.services.draft_store import read_draft, write_draft, delete_draft
    draft = {"imageName": "a.png", "shapes": []}
    write_draft(tmp_work_dir, "b1", "a.png", draft)
    assert read_draft(tmp_work_dir, "b1", "a.png") == draft
    delete_draft(tmp_work_dir, "b1", "a.png")
    assert read_draft(tmp_work_dir, "b1", "a.png") is None


def test_draft_path_uses_stem(tmp_work_dir):
    from app.services.draft_store import write_draft
    import os
    write_draft(tmp_work_dir, "b1", "img-001.png", {"imageName": "img-001.png"})
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "drafts", "img-001.json"))
