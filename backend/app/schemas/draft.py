from pydantic import BaseModel
from app.schemas.annotation import ShapeSchema


class DraftResponse(BaseModel):
    imageName: str
    modelConfigId: int
    modelName: str
    createdAt: str
    shapes: list[ShapeSchema]


class DraftSaveRequest(BaseModel):
    shapes: list[ShapeSchema]


class DraftAcceptRequest(BaseModel):
    expectedRev: int


class DraftAcceptResponse(BaseModel):
    rev: int
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str]
