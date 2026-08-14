from typing import Literal
from pydantic import BaseModel, Field


class ShapeSchema(BaseModel):
    id: str = Field(description="Unique shape identifier (UUID)")
    label: str = Field(min_length=1, max_length=128)
    shapeType: Literal["polygon"] = "polygon"
    points: list[list[float]] = Field(description="List of [x, y] vertex pairs (outer ring)")
    holes: list[list[list[float]]] = Field(default_factory=list, description="Inner hole rings")


class AnnotationSaveRequest(BaseModel):
    expectedRev: int = Field(alias="expectedRev", description="Client's version for optimistic locking")
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str] = Field(default_factory=dict)


class AnnotationResponse(BaseModel):
    rev: int
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str]
    savedAt: str


class AnnotationReadResponse(BaseModel):
    schemaVersion: int = 1
    imageName: str
    imageWidth: int
    imageHeight: int
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str]
    version: int


class MaskExportRequest(BaseModel):
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str] = Field(default_factory=dict)


class MaskExportResponse(BaseModel):
    saved: list[str]
    errors: list[dict[str, str]] = Field(default_factory=list)
