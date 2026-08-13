import os
from fastapi.testclient import TestClient
from PIL import Image as PILImage
import numpy as np


def _admin_token(client: TestClient) -> str:
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin_img", password_hash=hash_password("admin1234"), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestServeImageFile:
    def test_serve_image_200(self, client: TestClient, tmp_work_dir: str):
        token = _admin_token(client)

        # Create a batch and image record
        batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch", "images")
        os.makedirs(batches_dir)
        img = PILImage.fromarray(np.zeros((50, 50, 3), dtype=np.uint8) + 128)
        img.save(os.path.join(batches_dir, "sample.png"))

        # Create batch + image in DB
        from app.main import app
        from app.core.db import get_db
        db = next(app.dependency_overrides[get_db]())
        from app.models.batch import Batch
        from app.models.image import Image

        batch = Batch(name="test-batch", source="upload")
        db.add(batch)
        db.commit()
        db.refresh(batch)

        image = Image(
            batch_id=batch.id,
            file_name="sample.png",
            src_rel_path="batches/test-batch/images/sample.png",
            width=50,
            height=50,
            channels=3,
        )
        db.add(image)
        db.commit()
        db.refresh(image)

        resp = client.get(f"/api/images/{image.id}/file", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert len(resp.content) > 0

    def test_serve_image_404(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/images/99999/file", headers=_auth(token))
        assert resp.status_code == 404

    def test_serve_image_requires_auth(self, client: TestClient):
        resp = client.get("/api/images/1/file")
        assert resp.status_code == 401
