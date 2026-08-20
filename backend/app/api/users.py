from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import hash_password
from app.models.user import User
from app.models.image import Image
from app.models.batch import Batch
from app.schemas.user import UserCreate, UserUpdate, UserResponse, WorkDirUpdate
from app.api.deps import require_admin, get_current_user
from app.services.scanner import cleanup_missing_batches
from app.services.work_dir import get_work_dir

router = APIRouter()


@router.get("/users", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return db.query(User).order_by(User.created_at.desc()).all()


@router.get("/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/users/me/work_dir", response_model=UserResponse)
def update_my_work_dir(
    body: WorkDirUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.work_dir = body.work_dir
    # 切换工作目录后，清理数据库里在新目录下已不存在的批次（含其图像）
    cleanup_missing_batches(get_work_dir(db, current_user), db, created_by=current_user.id)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role="annotator",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # 不允许删除自己
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    # 目标用户是管理员时，仅原始 admin 账号可以删除
    if user.role == "admin":
        if admin.username != "admin":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only the primary admin can delete admin users")
        admin_count = db.query(User).filter(User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete the last admin")

    # 清除外键引用
    db.query(Image).filter(Image.locked_by == user_id).update({"locked_by": None})
    db.query(Batch).filter(Batch.created_by == user_id).update({"created_by": None})

    db.delete(user)
    db.commit()

