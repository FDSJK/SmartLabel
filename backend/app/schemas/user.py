from datetime import datetime
from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class UserUpdate(BaseModel):
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=128)


class WorkDirUpdate(BaseModel):
    work_dir: str = Field(max_length=1024)


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    work_dir: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
