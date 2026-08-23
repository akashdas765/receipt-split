"""Mirrors db.js's updateSplitwiseKey — validates a candidate key against
Splitwise's own API before persisting it, so a bad paste never gets
written. Simpler server-side than the JS version: no session singleton to
swap-and-roll-back, just validate first, write only on success.
"""

from fastapi import APIRouter, Depends, HTTPException

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import user_doc
from backend.models.user import SplitwiseKeyIn
from backend.services.splitwise_client import SplitwiseError, get_current_user

router = APIRouter(prefix="/api/user", tags=["user"])


@router.patch("/splitwise-key")
async def update_splitwise_key(body: SplitwiseKeyIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    try:
        await get_current_user(body.key)
    except SplitwiseError as err:
        raise HTTPException(
            status_code=400,
            detail="Could not verify this Splitwise API key — check that it was copied correctly.",
        ) from err
    user_doc(db, uid).set({"splitwise_api_key": body.key}, merge=True)
    return {"ok": True}
