from datetime import datetime
from pydantic import BaseModel


class InferenceTriggerResponse(BaseModel):
    jobId: int


class BatchInferenceResponse(BaseModel):
    queued: int
    jobIds: list[int]


class InferenceJobResponse(BaseModel):
    id: int
    image_id: int
    model_config_id: int
    scope: str
    status: str
    error: str | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}
