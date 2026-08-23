"""FastAPI dependency that loads the caller's own stored Splitwise API key
from Firestore (users/{uid}.splitwise_api_key — the same field
updateSplitwiseKey/db.js's PATCH /api/user/splitwise-key writes), rather
than trusting a client-supplied header the way the old x-splitwise-key
proxy header did. The frontend no longer needs to hold or forward the key
at all for anything except the Settings save-a-new-key flow itself.
"""

from fastapi import Depends, HTTPException

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import user_doc


def get_splitwise_key(uid: str = Depends(get_uid), db=Depends(get_db)) -> str:
    snap = user_doc(db, uid).get()
    key = (snap.to_dict() or {}).get("splitwise_api_key") if snap.exists else None
    if not key:
        raise HTTPException(status_code=400, detail="No Splitwise API key on file — add one in Settings.")
    return key
