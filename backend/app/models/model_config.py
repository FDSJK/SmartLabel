from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")  # upload | path
    model_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    input_width: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    input_height: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    resize_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="stretch")  # stretch | letterbox
    normalize_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="min_max")  # min_max | mean_std | none
    mean: Mapped[list | None] = mapped_column(JSON, nullable=True)   # [r,g,b]，仅 mean_std
    std: Mapped[list | None] = mapped_column(JSON, nullable=True)    # [r,g,b]，仅 mean_std
    background_channel: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    categories: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # [{"label","channel"}]
    postprocess: Mapped[str] = mapped_column(String(16), nullable=False, default="argmax")  # argmax | sigmoid
    sigmoid_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
