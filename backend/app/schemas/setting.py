from pydantic import BaseModel, Field


class SettingUpdate(BaseModel):
    value: str = Field(min_length=0, max_length=1024)
