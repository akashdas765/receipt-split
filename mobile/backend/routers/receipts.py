"""Mirrors mobile/src/services/db.js's receipt functions 1:1 —
loadReceiptsForInsights, saveReceipt, deleteReceipt.
"""

from fastapi import APIRouter, Depends, Query

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import receipts_col
from backend.models.receipts import ReceiptIn

router = APIRouter(prefix="/api/receipts", tags=["receipts"])


@router.get("")
def list_receipts(
    limit: int = Query(default=200, le=500),
    uid: str = Depends(get_uid),
    db=Depends(get_db),
):
    q = receipts_col(db, uid).order_by("scanned_at", direction="DESCENDING").limit(limit)
    return [{"id": d.id, **d.to_dict()} for d in q.stream()]


@router.post("")
def save_receipt(receipt: ReceiptIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    data = receipt.model_dump(exclude_unset=True, exclude={"id"})
    receipts_col(db, uid).document(receipt.id).set(data, merge=True)
    return {"ok": True}


@router.delete("/{receipt_id}")
def delete_receipt(receipt_id: str, uid: str = Depends(get_uid), db=Depends(get_db)):
    receipts_col(db, uid).document(receipt_id).delete()
    return {"ok": True}
