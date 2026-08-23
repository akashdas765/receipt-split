from pydantic import BaseModel


class ManualAccountIn(BaseModel):
    id: str | None = None  # omit to create, pass to update
    name: str
    balance: float
    type: str  # 'asset' | 'liability'
