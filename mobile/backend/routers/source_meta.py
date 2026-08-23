"""Mirrors db.js's loadSourceMeta/saveSourceMeta — the bank/credit tag for
non-Plaid transaction sources (CSV/PDF uploads, manual entries), keyed by
the source string itself.
"""

from fastapi import APIRouter, Depends

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import source_meta_col
from backend.models.source_meta import SourceMetaIn, with_timestamp

router = APIRouter(prefix="/api/source-meta", tags=["source-meta"])


@router.get("")
def load_source_meta(uid: str = Depends(get_uid), db=Depends(get_db)):
    return {d.id: d.to_dict() for d in source_meta_col(db, uid).stream()}


@router.post("")
def save_source_meta(body: SourceMetaIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    data = with_timestamp(body.model_dump(exclude_unset=True, exclude={"sourceId"}))
    source_meta_col(db, uid).document(body.sourceId).set(data, merge=True)
    return {"ok": True}
