"""Mirrors db.js's logNotification/loadNotifications/markNotificationRead —
a persisted log written at the moment each event actually occurs (receipt
parsed, posted to Splitwise, a bank linked), never synthesized after the
fact.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import notifications_col
from backend.models.notifications import NotificationIn

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.post("")
def log_notification(body: NotificationIn, uid: str = Depends(get_uid), db=Depends(get_db)):
    # receiptId/navigateTo omitted entirely when absent (exclude_unset),
    # not written as null — Firestore already handles this fine either way
    # in Python, but this keeps doc shape identical to what the JS client
    # used to write.
    data = {
        **body.model_dump(exclude_unset=True, exclude={"type", "text"}),
        "type": body.type,
        "text": body.text,
        "read": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    ref = notifications_col(db, uid).document()
    ref.set(data)
    return {"id": ref.id}


# Most recent 50 — a running feed for the bell icon, not a full audit log.
@router.get("")
def load_notifications(uid: str = Depends(get_uid), db=Depends(get_db)):
    q = notifications_col(db, uid).order_by("createdAt", direction="DESCENDING").limit(50)
    return [{"id": d.id, **d.to_dict()} for d in q.stream()]


@router.patch("/{notification_id}/read")
def mark_notification_read(notification_id: str, uid: str = Depends(get_uid), db=Depends(get_db)):
    notifications_col(db, uid).document(notification_id).set({"read": True}, merge=True)
    return {"ok": True}
