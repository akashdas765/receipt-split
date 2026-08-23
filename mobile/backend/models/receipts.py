"""Receipts carry a large, evolving free-form shape (items[], personTotals{},
category, approved, splitwise_expense_id, grandTotal, ...) that's opaque to
the backend — CRUD here just persists exactly what the client sends, same
as the old Firestore client SDK did directly, rather than re-validating
every nested field server-side.
"""

from pydantic import BaseModel, ConfigDict


class ReceiptIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
