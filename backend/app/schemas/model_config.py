from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class CategoryMapping(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    channel: int = Field(ge=0)


class ModelConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    source: Literal["upload", "path"] = "upload"
    model_path: str = Field(min_length=1, max_length=1024)
    input_width: int = Field(default=512, ge=1)
    input_height: int = Field(default=512, ge=1)
    resize_mode: Literal["stretch", "letterbox"] = "stretch"
    normalize_mode: Literal["min_max", "mean_std", "none"] = "min_max"
    mean: list[float] | None = None
    std: list[float] | None = None
    background_channel: int = 0
    categories: list[CategoryMapping] = []
    postprocess: Literal["argmax", "sigmoid"] = "argmax"
    sigmoid_threshold: float = 0.5
    enabled: bool = True


class ModelConfigUpdate(ModelConfigCreate):
    pass


class ModelConfigResponse(BaseModel):
    id: int
    name: str
    source: str
    model_path: str
    input_width: int
    input_height: int
    resize_mode: str
    normalize_mode: str
    mean: list[float] | None
    std: list[float] | None
    background_channel: int
    categories: list[dict]
    postprocess: str
    sigmoid_threshold: float
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
