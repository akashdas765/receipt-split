"""Mirrors db.js's loadManualAccounts/saveManualAccount/deleteManualAccount
— balances with no transaction feed (rewards points, cash, a hand-tracked
loan, ...), folded into HomePage's net worth total.
"""

from fastapi import APIRouter, Depends

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import manual_accounts_col
from backend.models.manual_accounts import ManualAccountIn

router = APIRouter(prefix="/api/manual-accounts", tags=["manual-accounts"])


@router.get("")
def list_manual_accounts(uid: str = Depends(get_uid), db=Depends(get_db)):
    return [{"id": d.id, **d.to_dict()} for d in manual_accounts_col(db, uid).stream()]


@router.post("")
def save_manual_account(body: ManualAccountIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    col = manual_accounts_col(db, uid)
    ref = col.document(body.id) if body.id else col.document()
    ref.set({"name": body.name, "balance": body.balance, "type": body.type}, merge=True)
    return {"id": ref.id}


@router.delete("/{account_id}")
def delete_manual_account(account_id: str, uid: str = Depends(get_uid), db=Depends(get_db)):
    manual_accounts_col(db, uid).document(account_id).delete()
    return {"ok": True}
