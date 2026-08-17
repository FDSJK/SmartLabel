# backend/app/schemas/export.py
from typing import Literal
from pydantic import BaseModel, model_validator


class ExportRequest(BaseModel):
    scope: Literal["image", "batch", "all"]
    imageId: int | None = None
    batchId: int | None = None
    formats: list[Literal["mask", "coco", "labelme"]]
    skipUnconfirmed: bool = False

    @model_validator(mode="after")
    def _check_ids(self):
        if self.scope == "image" and self.imageId is None:
            raise ValueError("imageId is required when scope is 'image'")
        if self.scope == "batch" and self.batchId is None:
            raise ValueError("batchId is required when scope is 'batch'")
        if not self.formats:
            raise ValueError("formats must not be empty")
        return self


class PendingItem(BaseModel):
    image: str
    labels: list[str]


class ExportResponse(BaseModel):
    exportDir: str
    imageCount: int
    annotationCount: int
    maskCount: int
    pending: list[PendingItem] = []
    errors: list[dict[str, str]] = []
