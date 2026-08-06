from datetime import datetime
from pydantic import BaseModel


class ImageResponse(BaseModel):
    id: int
    batch_id: int
    file_name: str
    width: int
    height: int
    channels: int
    status: str
    locked_by: int | None
    locked_by_username: str | None = None
    annotation_rev: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
