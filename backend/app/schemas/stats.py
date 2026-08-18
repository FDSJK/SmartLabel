from pydantic import BaseModel


class LabelStat(BaseModel):
    name: str
    present: int
    absent: int
    pending: int


class StatsResponse(BaseModel):
    totalImages: int
    labels: list[LabelStat]
