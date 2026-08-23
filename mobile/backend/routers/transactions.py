"""Mirrors mobile/src/services/db.js's transaction functions — loadTransactions,
addTransactions, setTransactionOverride + updateTransactionCategory
(collapsed into one PATCH per the plan), deleteTransaction,
deleteTransactionsBySource, reclassifyTransactions, renameTransactionsSource.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import transactions_col
from backend.models.transactions import AddTransactionsIn, RenameSourceIn, TransactionPatch
from backend.services.payment_detector import is_credit_confirmation, is_income_transaction, is_payment_transaction

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

# Same cap loadTransactions() used client-side — a single flat query, not
# paginated. TransactionsPage/HomePage surface a banner when the count hits
# this exactly, so older transactions across all accounts may be missing.
TXN_MAX = 1000


@router.get("")
def list_transactions(uid: str = Depends(get_uid), db=Depends(get_db)):
    q = transactions_col(db, uid).order_by("date", direction="DESCENDING").limit(TXN_MAX)
    return [{"id": d.id, **d.to_dict()} for d in q.stream()]


# merge:true per transaction so re-adding an already-stored one (e.g. a
# Plaid full-history re-sync re-tagging older rows by card) updates its
# fields without wiping any overrideSplitwiseId/etc. already set on it.
@router.post("")
def add_transactions(body: AddTransactionsIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    col = transactions_col(db, uid)
    uploaded_at = datetime.now(timezone.utc).isoformat()
    batch = db.batch()
    for txn in body.transactions:
        data = txn.model_dump(exclude_unset=True, exclude={"id"})
        data["sourceName"] = body.sourceName
        data["uploadedAt"] = uploaded_at
        batch.set(col.document(txn.id), data, merge=True)
    batch.commit()
    return {"ok": True}


@router.patch("/source/{source}")
def rename_transactions_source(source: str, body: RenameSourceIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    col = transactions_col(db, uid)
    docs = col.where("source", "==", source).stream()
    batch = db.batch()
    for d in docs:
        batch.update(d.reference, {"sourceName": body.sourceName})
    batch.commit()
    return {"ok": True}


# Self-contained (queries the user's own transactions directly) rather than
# taking the caller's already-loaded list like reclassifyTransactions(list)
# did client-side — the backend has direct Firestore access, no reason to
# round-trip the whole list through the request body.
@router.post("/reclassify")
def reclassify_transactions(uid: str = Depends(get_uid), db=Depends(get_db)):
    col = transactions_col(db, uid)
    to_fix = []
    for d in col.limit(TXN_MAX).stream():
        t = d.to_dict()
        description = t.get("description", "")
        fields = {}
        if not t.get("isPayment") and is_payment_transaction(description):
            fields["isPayment"] = True
            if is_credit_confirmation(description):
                fields["isCredit"] = True
        if not t.get("isIncome") and t.get("isCredit") and is_income_transaction(description):
            fields["isIncome"] = True
        if fields:
            to_fix.append((d.id, fields))
    if not to_fix:
        return []
    batch = db.batch()
    for doc_id, fields in to_fix:
        batch.update(col.document(doc_id), fields)
    batch.commit()
    return [{"id": doc_id, "fields": fields} for doc_id, fields in to_fix]


@router.patch("/{transaction_id}")
def patch_transaction(transaction_id: str, patch: TransactionPatch, uid: str = Depends(get_uid), db=Depends(get_db)):
    data = patch.model_dump(exclude_unset=True)
    if data:
        transactions_col(db, uid).document(transaction_id).set(data, merge=True)
    return {"ok": True}


@router.delete("/{transaction_id}")
def delete_transaction(transaction_id: str, uid: str = Depends(get_uid), db=Depends(get_db)):
    transactions_col(db, uid).document(transaction_id).delete()
    return {"ok": True}


@router.delete("")
def delete_transactions_by_source(source: str = Query(...), uid: str = Depends(get_uid), db=Depends(get_db)):
    col = transactions_col(db, uid)
    docs = col.where("source", "==", source).stream()
    batch = db.batch()
    for d in docs:
        batch.delete(d.reference)
    batch.commit()
    return {"ok": True}
