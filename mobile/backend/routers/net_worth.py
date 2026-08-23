"""Mirrors db.js's saveNetWorthSnapshot/loadNetWorthHistory — a running
daily history of the client-computed net worth number, purely so the
"+X% this month" trend has a real past value to compare against. Net worth
itself is never the source of truth here; HomePage always recomputes it
live.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends

from backend.deps.auth import get_uid
from backend.deps.firestore import get_db
from backend.firestore_paths import net_worth_snapshots_col

router = APIRouter(prefix="/api/net-worth-snapshots", tags=["net-worth"])


@router.post("")
def save_net_worth_snapshot(net_worth: float = Body(..., embed=True, alias="netWorth"), uid: str = Depends(get_uid), db=Depends(get_db)):
    date = datetime.now(timezone.utc).date().isoformat()
    net_worth_snapshots_col(db, uid).document(date).set({"date": date, "netWorth": net_worth}, merge=True)
    return {"ok": True}


# Last ~45 days, oldest first — enough slack to still find something ~30
# days back for a month-over-month comparison even if some days were
# skipped (app not opened that day).
@router.get("")
def load_net_worth_history(uid: str = Depends(get_uid), db=Depends(get_db)):
    q = net_worth_snapshots_col(db, uid).order_by("date", direction="DESCENDING").limit(45)
    return list(reversed([d.to_dict() for d in q.stream()]))
