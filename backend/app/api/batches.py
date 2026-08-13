import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from app.core.db import get_db
import app.core.config as _config
from app.models.batch import Batch
from app.models.image import Image
from app.models.setting import Setting
from app.models.user import User
from app.schemas.batch import BatchCreate, BatchResponse
from app.schemas.image import ImageResponse
from app.api.deps import require_admin, get_current_user
from app.services.scanner import scan_batches
from app.services.mask_import import import_batch_masks, import_all_batches

router = APIRouter()


def _get_work_dir(db: Session) -> str:
    """Read WORK_DIR from the database settings table, fall back to config default."""
    row = db.query(Setting).filter(Setting.key == "WORK_DIR").first()
    if row and row.value.strip():
        return row.value.strip()
    return _config.settings.WORK_DIR


def _batch_to_response(b: Batch, db: Session) -> BatchResponse:
    total = db.query(Image).filter(Image.batch_id == b.id).count()
    done = db.query(Image).filter(Image.batch_id == b.id, Image.status == "done").count()
    return BatchResponse(
        id=b.id,
        name=b.name,
        source=b.source,
        note=b.note,
        created_at=b.created_at,
        image_count=total,
        done_count=done,
    )


def _image_to_response(img: Image, db: Session) -> ImageResponse:
    locked_username = None
    if img.locked_by:
        locker = db.query(User).filter(User.id == img.locked_by).first()
        locked_username = locker.username if locker else None
    return ImageResponse(
        id=img.id,
        batch_id=img.batch_id,
        file_name=img.file_name,
        width=img.width,
        height=img.height,
        channels=img.channels,
        status=img.status,
        locked_by=img.locked_by,
        locked_by_username=locked_username,
        annotation_rev=img.annotation_rev,
        created_at=img.created_at,
        updated_at=img.updated_at,
    )


@router.get("/batches", response_model=list[BatchResponse])
def list_batches(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    batches = db.query(Batch).order_by(Batch.created_at.desc()).all()
    return [_batch_to_response(b, db) for b in batches]


@router.post("/batches", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
def create_batch(
    body: BatchCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = db.query(Batch).filter(Batch.name == body.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch name already exists")
    batch = Batch(name=body.name, source="upload", created_by=admin.id)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return _batch_to_response(batch, db)


@router.delete("/batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    # 检查是否有已标注的图片
    annotated = db.query(Image).filter(
        Image.batch_id == batch_id,
        Image.annotation_rev > 0,
    ).count()
    if annotated > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch has {annotated} annotated image(s), cannot delete",
        )

    # 删除文件系统中的批次目录
    work_dir = _get_work_dir(db)
    batch_dir = os.path.join(work_dir, "batches", batch.name)
    if os.path.isdir(batch_dir):
        shutil.rmtree(batch_dir)

    db.delete(batch)
    db.commit()


@router.post("/batches/scan")
def trigger_scan(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    work_dir = _get_work_dir(db)
    result = scan_batches(work_dir, db, created_by=admin.id)
    imp = import_all_batches(work_dir, db, username=admin.username)
    result["imported"] = imp["imported"]
    result["created_labels"] = list(dict.fromkeys(imp["created_labels"]))
    result["errors"].extend(imp["errors"])
    return result


@router.post("/batches/{batch_id}/upload", response_model=list[ImageResponse])
async def upload_images(
    batch_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = _get_work_dir(db)
    batch_dir = os.path.join(work_dir, "batches", batch.name)
    images_dir = os.path.join(batch_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    from app.services.image_processor import get_image_info, convert_to_rgb

    results: list[ImageResponse] = []
    for f in files:
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
            continue

        dest_name = f.filename
        dest_path = os.path.join(images_dir, dest_name)
        if os.path.exists(dest_path):
            stem, ext_ = os.path.splitext(f.filename)
            dest_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext_}"
            dest_path = os.path.join(images_dir, dest_name)

        with open(dest_path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)

        info = get_image_info(dest_path)
        src_rel = os.path.relpath(dest_path, start=work_dir)
        work_rel = None
        if info["channels"] > 3:
            cache_dir = os.path.join(batch_dir, "cache", "rgb")
            os.makedirs(cache_dir, exist_ok=True)
            work_rel = convert_to_rgb(dest_path, cache_dir)

        image = Image(
            batch_id=batch.id,
            file_name=dest_name,
            src_rel_path=src_rel,
            work_rel_path=work_rel,
            width=info["width"],
            height=info["height"],
            channels=min(info["channels"], 3),
            status="pending",
        )
        db.add(image)
        db.flush()
        results.append(_image_to_response(image, db))

    db.commit()
    return results


@router.get("/batches/{batch_id}/images", response_model=list[ImageResponse])
def list_images(
    batch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    images = db.query(Image).filter(Image.batch_id == batch_id).order_by(Image.file_name).all()
    return [_image_to_response(img, db) for img in images]


@router.post("/batches/{batch_id}/import-masks")
def import_masks(
    batch_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = _get_work_dir(db)
    r = import_batch_masks(work_dir, batch, db, username=admin.username)
    r["created_labels"] = list(dict.fromkeys(r["created_labels"]))
    return r


@router.get("/images/{image_id}", response_model=ImageResponse)
def get_image(
    image_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return _image_to_response(img, db)
