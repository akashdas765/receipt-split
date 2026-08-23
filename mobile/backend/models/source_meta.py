from datetime import datetime, timezone

from pydantic import BaseModel


class SourceMetaIn(BaseModel):
    sourceId: str
    accountType: str | None = None  # 'bank' | 'credit'
    label: str | None = None


def with_timestamp(data: dict) -> dict:
    return {**data, "updatedAt": datetime.now(timezone.utc).isoformat()}
