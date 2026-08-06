from datetime import datetime
from pydantic import BaseModel, Field


class BatchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)


class BatchResponse(BaseModel):
    id: int
    name: str
    source: str
    note: str
    created_at: datetime
    image_count: int = 0
    done_count: int = 0

    model_config = {"from_attributes": True}
