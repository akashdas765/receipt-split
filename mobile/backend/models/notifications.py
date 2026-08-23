from pydantic import BaseModel


class NotificationIn(BaseModel):
    type: str
    text: str
    receiptId: str | None = None
    navigateTo: str | None = None
