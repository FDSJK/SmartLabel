from datetime import datetime
from pydantic import BaseModel, Field


class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str = Field(default="#3388ff", pattern=r"^#[0-9a-fA-F]{6}$")


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    enabled: bool | None = None
    sort_order: int | None = None


class LabelResponse(BaseModel):
    id: int
    name: str
    color: str
    enabled: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ImportTxtRequest(BaseModel):
    content: str = Field(min_length=1, description="Raw text content of the labels file")
