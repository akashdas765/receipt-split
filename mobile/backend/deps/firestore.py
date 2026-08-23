"""Lazy Firestore client singleton — mirrors mobile/src/services/firebase.js's
role for the frontend (initialize once, survive repeated calls).
"""

from firebase_admin import firestore

from backend.deps.auth import _ensure_initialized

_db = None


def get_db():
    """FastAPI dependency — yields the Firestore client.

    Shares the same firebase_admin app init as get_uid (both need the app
    initialized; whichever dependency resolves first does the actual
    init, the other is a no-op via _ensure_initialized's own guard).
    """
    global _db
    _ensure_initialized()
    if _db is None:
        _db = firestore.client()
    return _db
