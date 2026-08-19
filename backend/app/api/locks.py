from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.image import Image
from app.models.user import User
from app.api.deps import get_current_user, get_owned_image

router = APIRouter()

LOCK_TIMEOUT_MINUTES = 30


@router.post("/images/{image_id}/lock")
def acquire_lock(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = get_owned_image(db, current_user, image_id)

    now = datetime.utcnow()
    timeout = now - timedelta(minutes=LOCK_TIMEOUT_MINUTES)

    # Check if there's an active lock held by someone else
    if img.locked_by is not None and img.locked_at is not None and img.locked_at > timeout:
        if img.locked_by == current_user.id:
            # Same user — refresh the lock
            img.locked_at = now
            db.commit()
            return {
                "locked": True,
                "locked_by_username": current_user.username,
            }
        else:
            # Different user holds the lock
            locker = db.query(User).filter(User.id == img.locked_by).first()
            return {
                "locked": False,
                "locked_by_username": locker.username if locker else "unknown",
            }

    # Lock is free or expired — acquire it
    img.locked_by = current_user.id
    img.locked_at = now
    if img.status == "pending":
        img.status = "in_progress"
    db.commit()

    return {
        "locked": True,
        "locked_by_username": current_user.username,
    }


@router.post("/images/{image_id}/heartbeat")
def heartbeat(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = get_owned_image(db, current_user, image_id)

    if img.locked_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You do not hold the lock on this image",
        )

    img.locked_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.delete("/images/{image_id}/lock", status_code=status.HTTP_204_NO_CONTENT)
def release_lock(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = get_owned_image(db, current_user, image_id)

    # Idempotent — only clear if this user holds the lock
    if img.locked_by == current_user.id:
        img.locked_by = None
        img.locked_at = None
        db.commit()

    return None
