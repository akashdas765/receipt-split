"""Firebase ID token verification — the Python equivalent of
mobile/shared/verifyFirebaseToken.js, now via firebase-admin instead of
manual JWKS handling (the JS version avoided firebase-admin specifically
because of a Node/Vercel bundling issue that doesn't apply here).
"""

import logging

import firebase_admin
from fastapi import Header, HTTPException
from firebase_admin import auth as fb_auth
from firebase_admin import credentials

from backend.config import firebase_service_account

logger = logging.getLogger("truespend")

_initialized = False


def _ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    # Lazy, not at module import — fail loudly on the first real request
    # rather than breaking every cold start or FastAPI's own OpenAPI-doc
    # generation if the service-account env var is malformed.
    cred = credentials.Certificate(firebase_service_account())
    firebase_admin.initialize_app(cred)
    _initialized = True


async def get_uid(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency — verifies the bearer token, returns the uid.

    Every failure mode (missing header, expired token, bad signature,
    wrong project, network failure reaching Google) collapses to the same
    401 — verification details are logged server-side only, never
    surfaced to the client. Matches verifyFirebaseToken.js's fail-closed
    design; don't regress it.

    Used as Depends(get_uid) directly on each protected route rather than
    a router-level blanket dependency — nearly every handler needs the
    actual uid value to build the users/{uid}/... Firestore path, so a
    blanket dependency would just mean re-deriving it anyway.
    """
    # _ensure_initialized() is inside the same try/except as verify_id_token
    # below — a bad/missing FIREBASE_SERVICE_ACCOUNT_B64 must fail closed
    # the same as a bad token, not leak as an unhandled 500 (Firebase-init
    # errors aren't the caller's fault to see either way, but they still
    # shouldn't get a different, more revealing failure mode than "auth
    # didn't work").
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid auth token")
    token = authorization.removeprefix("Bearer ")
    try:
        _ensure_initialized()
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001 — deliberately broad, see docstring
        logger.warning("verify_id_token failed: %s", err)
        raise HTTPException(status_code=401, detail="Missing or invalid auth token") from err
