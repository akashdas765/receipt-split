"""Purpose-built Splitwise endpoints — NOT a literal port of the old
generic path-allowlisted relay (shared/splitwiseProxy.js), which existed
solely as a CORS workaround with no secret to protect (it forwarded the
user's own key). Now that the browser doesn't call Splitwise directly at
all, these do the response-reshaping src/services/splitwise.js used to do
client-side, and read the caller's Splitwise API key from Firestore
(get_splitwise_key) instead of a client-supplied header.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps.splitwise_key import get_splitwise_key
from backend.models.splitwise import CategoryPatch, PostExpenseIn
from backend.services import splitwise_client as sw
from backend.services.splitwise_client import SplitwiseError

router = APIRouter(prefix="/api/splitwise", tags=["splitwise"])

_SKIP_DESC = re.compile(r"settle|settlement|reimburs|payback|pay back|paid back", re.IGNORECASE)


def _display_names(members: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for m in members:
        fn = (m.get("first_name") or "").strip().lower()
        counts[fn] = counts.get(fn, 0) + 1
    out = []
    for m in members:
        fn = (m.get("first_name") or "").strip()
        ln = (m.get("last_name") or "").strip()
        display = f"{fn} {ln[0].upper()}" if counts.get(fn.lower(), 0) > 1 and ln else fn
        out.append({**m, "name": display})
    return out


@router.get("/groups")
async def groups_route(key: str = Depends(get_splitwise_key)):
    try:
        groups = await sw.get_groups(key)
    except SplitwiseError as err:
        raise HTTPException(status_code=502, detail=str(err) or "Could not load Splitwise groups.") from err
    return [
        {
            "id": g["id"],
            "name": g["name"],
            "members": [{"id": m["id"], "name": m["name"]} for m in _display_names(g.get("members") or [])],
        }
        for g in groups
    ]


# id kept as a string (not int) — same as the old client-side fetchCurrentUser,
# used to key personTotals/paidAmounts dicts, whose JSON keys are always strings.
@router.get("/me")
async def me_route(key: str = Depends(get_splitwise_key)):
    try:
        user = await sw.get_current_user(key)
    except SplitwiseError as err:
        raise HTTPException(status_code=502, detail=str(err) or "Could not load your Splitwise profile.") from err
    return {"id": str(user["id"]), "name": user.get("first_name"), "lastName": user.get("last_name") or ""}


@router.get("/balance")
async def balance_route(key: str = Depends(get_splitwise_key)):
    try:
        friends = await sw.get_friends(key)
    except SplitwiseError as err:
        raise HTTPException(status_code=502, detail=str(err) or "Could not load your Splitwise balance.") from err
    net = 0.0
    for friend in friends:
        for b in friend.get("balance") or []:
            if (b.get("currency_code") or "USD") == "USD":
                net += float(b.get("amount") or 0)
    return {"net": net}


@router.get("/categories")
async def categories_route(key: str = Depends(get_splitwise_key)):
    try:
        categories = await sw.get_categories(key)
    except SplitwiseError as err:
        raise HTTPException(status_code=502, detail=str(err) or "Could not load Splitwise categories.") from err
    return [
        {
            "id": c["id"],
            "name": c["name"],
            "subcategories": [{"id": sc["id"], "name": sc["name"]} for sc in (c.get("subcategories") or [])],
        }
        for c in categories
    ]


def _reshape_expense(e: dict, my_id: str) -> dict:
    user_share = next((u for u in (e.get("users") or []) if str(u.get("user_id")) == my_id), None)
    return {
        "id": e["id"],
        "description": e.get("description"),
        "cost": float(e["cost"]),
        "currency_code": e.get("currency_code") or "USD",
        "date": e.get("date"),
        "group_id": e.get("group_id"),
        "category": (e.get("category") or {}).get("name") or "Other",
        "categoryId": (e.get("category") or {}).get("id"),
        "addedBy": (e.get("created_by") or {}).get("first_name"),
        "myPaidShare": float((user_share or {}).get("paid_share") or 0),
        "myOwedShare": float((user_share or {}).get("owed_share") or 0),
        "myNetBalance": float((user_share or {}).get("net_balance") or 0),
        "splits": [
            {
                "id": u.get("user_id"),
                "name": " ".join(filter(None, [(u.get("user") or {}).get("first_name"), (u.get("user") or {}).get("last_name")])) or "Someone",
                "paidShare": float(u.get("paid_share") or 0),
                "owedShare": float(u.get("owed_share") or 0),
            }
            for u in (e.get("users") or [])
        ],
    }


# myId is resolved server-side (an extra get_current_user call) rather than
# taken as a query param the way the old client-side fetchAllExpenses(myId, ...)
# did — the backend already has the verified caller, no reason to trust a
# client-supplied id for something that determines "your share" math.
@router.get("/expenses")
async def expenses_route(
    dated_after: str | None = Query(default=None),
    dated_before: str | None = Query(default=None),
    group_id: int | None = Query(default=None),
    key: str = Depends(get_splitwise_key),
):
    try:
        me = await sw.get_current_user(key)
        my_id = str(me["id"])
        raw_expenses = await sw.get_expenses(key, dated_after, dated_before, group_id)
    except SplitwiseError as err:
        raise HTTPException(status_code=502, detail=str(err) or "Could not load Splitwise expenses.") from err

    all_expenses = [
        _reshape_expense(e, my_id)
        for e in raw_expenses
        if not e.get("deleted_at") and not e.get("payment") and not _SKIP_DESC.search(e.get("description") or "")
    ]

    # Splitwise groups can mix currencies — every $ total in this app
    # assumes USD, so foreign-currency expenses are split out rather than
    # blended into totals (see splitwise.js's own comment for the same
    # reasoning this was ported from).
    expenses = [e for e in all_expenses if e["currency_code"] == "USD"]
    other_currency_expenses = [e for e in all_expenses if e["currency_code"] != "USD"]

    payments_received = []
    for e in raw_expenses:
        if e.get("deleted_at") or e.get("payment") is not True:
            continue
        user_share = next((u for u in (e.get("users") or []) if str(u.get("user_id")) == my_id), None)
        received = float((user_share or {}).get("owed_share") or 0)
        if received <= 0:
            continue
        payer = next((u for u in (e.get("users") or []) if float(u.get("paid_share") or 0) > 0), None)
        payments_received.append({
            "id": e["id"],
            "description": e.get("description") or "Payment",
            "amount": received,
            "date": e.get("date"),
            "paidBy": (payer.get("user") or {}).get("first_name") if payer else "Someone",
            "group_id": e.get("group_id"),
        })

    return {"expenses": expenses, "otherCurrencyExpenses": other_currency_expenses, "paymentsReceived": payments_received}


@router.patch("/expenses/{expense_id}/category")
async def update_category_route(expense_id: int, body: CategoryPatch, key: str = Depends(get_splitwise_key)):
    try:
        expense = await sw.update_expense_category(key, expense_id, body.categoryId)
    except SplitwiseError as err:
        raise HTTPException(status_code=400, detail=str(err) or "Splitwise rejected the category change.") from err
    category = expense.get("category") or {}
    return {"category": category.get("name"), "categoryId": category.get("id")}


# Creates a new expense, or updates an existing one if expenseId is given
# (re-posting an already-approved receipt updates instead of duplicating).
@router.post("/expenses")
async def post_expense_route(body: PostExpenseIn, key: str = Depends(get_splitwise_key)):
    total_amount = sum(body.personTotals.values())
    form = {
        "cost": f"{total_amount:.2f}",
        "description": body.description,
        "group_id": body.groupId,
        "currency_code": "USD",
    }
    if body.details:
        form["details"] = body.details
    for i, m in enumerate(body.members):
        mid = str(m.id)
        form[f"users__{i}__user_id"] = m.id
        form[f"users__{i}__owed_share"] = f"{body.personTotals.get(mid, 0):.2f}"
        form[f"users__{i}__paid_share"] = f"{body.paidAmounts.get(mid, 0):.2f}"

    try:
        expense = await sw.create_or_update_expense(key, body.expenseId, form)
    except SplitwiseError as err:
        raise HTTPException(status_code=400, detail=str(err) or "Splitwise rejected the expense.") from err
    return expense
