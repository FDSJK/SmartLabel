import colorsys
import random
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.label import Label
from app.models.user import User
from app.schemas.label import LabelCreate, LabelUpdate, LabelResponse, ImportTxtRequest
from app.api.deps import require_admin, get_current_user

router = APIRouter()

DEFAULT_PALETTE = [
    "#ff4444", "#44ff44", "#4488ff", "#ffaa00", "#aa44ff",
    "#00cccc", "#ff66aa", "#aacc00", "#886644", "#ff8844",
]

# Golden angle in radians — produces well-distributed hues
_GOLDEN_ANGLE = 3.141592653589793 * 0.618033988749895
_hue_offset = random.random()  # random starting hue per process


def _vibrant_color(index: int) -> str:
    """Generate a vibrant, evenly-distributed color using the golden ratio method."""
    hue = (_hue_offset + index * _GOLDEN_ANGLE) % 1.0
    r, g, b = colorsys.hls_to_rgb(h=hue, l=0.55, s=0.75)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


def _next_color(db: Session) -> str:
    used = {label.color for label in db.query(Label).all()}
    for c in DEFAULT_PALETTE:
        if c not in used:
            return c
    # Palette exhausted — generate vibrant colors via golden-ratio hue distribution
    for i in range(1000):
        c = _vibrant_color(i)
        if c not in used:
            return c
    return "#808080"


@router.get("/labels", response_model=list[LabelResponse])
def list_labels(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return db.query(Label).order_by(Label.sort_order, Label.name).all()


@router.post("/labels", response_model=LabelResponse, status_code=status.HTTP_201_CREATED)
def create_label(
    body: LabelCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = db.query(Label).filter(Label.name == body.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label name already exists")
    max_order = db.query(Label).order_by(Label.sort_order.desc()).first()
    label = Label(
        name=body.name,
        color=body.color,
        sort_order=(max_order.sort_order + 1) if max_order else 0,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.put("/labels/{label_id}", response_model=LabelResponse)
def update_label(
    label_id: int,
    body: LabelUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    if body.name is not None:
        dup = db.query(Label).filter(Label.name == body.name, Label.id != label_id).first()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label name already taken")
        label.name = body.name
    if body.color is not None:
        label.color = body.color
    if body.enabled is not None:
        label.enabled = body.enabled
    if body.sort_order is not None:
        label.sort_order = body.sort_order
    db.commit()
    db.refresh(label)
    return label


@router.delete("/labels", status_code=status.HTTP_204_NO_CONTENT)
def clear_labels(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    db.query(Label).delete()
    db.commit()


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    db.delete(label)
    db.commit()


@router.post("/labels/import-txt", response_model=list[LabelResponse])
def import_labels_txt(
    body: ImportTxtRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    results: list[Label] = []
    for line in body.content.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line in ("__ignore__", "_background_"):
            continue
        parts = re.split(r"\s*,\s*", line, maxsplit=1)
        name = parts[0].strip()
        color = parts[1].strip() if len(parts) == 2 and re.match(r"^#[0-9a-fA-F]{6}$", parts[1].strip()) else None
        existing = db.query(Label).filter(Label.name == name).first()
        if existing:
            if color:
                existing.color = color
            results.append(existing)
        else:
            label = Label(name=name, color=color or _next_color(db))
            db.add(label)
            db.flush()
            results.append(label)
    db.commit()
    for r in results:
        db.refresh(r)
    return results
