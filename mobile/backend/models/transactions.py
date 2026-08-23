"""Transactions carry a large set of optional fields (override state from
utils/matcher.js, Plaid-sourced tags, ...) documented in db.js's own
comments — permissive passthrough for the body shape, same reasoning as
receipts, but the PATCH model is deliberately explicit (see TransactionPatch)
since override-clearing depends on distinguishing "field omitted" from
"field explicitly set to null".
"""

from typing import Any

from pydantic import BaseModel, ConfigDict


class TransactionIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str


class AddTransactionsIn(BaseModel):
    transactions: list[TransactionIn]
    sourceName: str


# All Optional[None-default] — combined with `.model_dump(exclude_unset=True)`
# in the router, a field the client never mentions is left untouched, while
# a field explicitly sent as `null` (e.g. clearing overrideSplitwiseId) is
# still written as a real null. Mirrors setTransactionOverride's arbitrary-
# fields merge write and updateTransactionCategory, collapsed into one route
# per the plan (db.js's split between the two was incidental, not semantic).
class TransactionPatch(BaseModel):
    category: str | None = None
    overrideSplitwiseId: str | None = None
    overrideExpenseData: dict[str, Any] | None = None
    overrideSplitwiseIds: list[str] | None = None
    overrideExpenseDataList: list[dict[str, Any]] | None = None
    overrideForcedUnmatched: bool | None = None
    overrideConfirmedTransfer: bool | None = None
    overrideDismissedTransferHint: bool | None = None


class RenameSourceIn(BaseModel):
    sourceName: str
