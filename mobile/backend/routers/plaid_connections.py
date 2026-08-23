"""Mirrors mobile/src/services/db.js's Plaid-connection functions —
loadPlaidConnections, savePlaidConnection, deletePlaidConnection.
migrateLegacyPlaidConnection is folded invisibly into GET (per the plan)
rather than exposed as its own endpoint — a one-shot fixup, not a real
feature surface.
"""

from fastapi import APIRouter, Depends

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import plaid_connections_col, user_doc
from backend.models.plaid_connections import PlaidConnectionIn

router = APIRouter(prefix="/api/plaid-connections", tags=["plaid-connections"])


def _migrate_legacy(uid: str, db) -> None:
    """Before multi-account support, the single Plaid connection lived as
    flat plaid_access_token/plaid_item_id/... fields directly on the user
    doc. Moves that into the plaidConnections subcollection (as its first
    entry) so an already-connected account isn't lost, then clears the old
    fields so this is a no-op on every later call.
    """
    snap = user_doc(db, uid).get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    if not data.get("plaid_access_token") or not data.get("plaid_item_id"):
        return
    item_id = data["plaid_item_id"]
    conn_data = {
        "accessToken": data["plaid_access_token"],
        "cursor": data.get("plaid_cursor"),
        "institutionName": data.get("plaid_institution_name"),
    }
    plaid_connections_col(db, uid).document(item_id).set(conn_data, merge=True)
    user_doc(db, uid).set(
        {
            "plaid_access_token": None,
            "plaid_item_id": None,
            "plaid_cursor": None,
            "plaid_institution_name": None,
        },
        merge=True,
    )


@router.get("")
def list_plaid_connections(uid: str = Depends(get_uid), db=Depends(get_db)):
    _migrate_legacy(uid, db)
    return [{"itemId": d.id, **d.to_dict()} for d in plaid_connections_col(db, uid).stream()]


@router.post("")
def save_plaid_connection(body: PlaidConnectionIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    data = body.model_dump(exclude_unset=True, exclude={"itemId"}, mode="json")
    plaid_connections_col(db, uid).document(body.itemId).set(data, merge=True)
    return {"ok": True}


@router.delete("/{item_id}")
def delete_plaid_connection(item_id: str, uid: str = Depends(get_uid), db=Depends(get_db)):
    plaid_connections_col(db, uid).document(item_id).delete()
    return {"ok": True}
