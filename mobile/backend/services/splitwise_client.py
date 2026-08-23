"""Splitwise API client — replaces the old generic path-allowlisted CORS
relay (shared/splitwiseProxy.js) now that the browser no longer calls
Splitwise directly. Thin wrappers around Splitwise's own endpoints; response
reshaping (the part src/services/splitwise.js used to do client-side) lives
in backend/routers/splitwise.py, which calls these.
"""

import urllib.parse

import httpx

SW_BASE = "https://secure.splitwise.com/api/v3.0"


class SplitwiseError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def _get(api_key: str, path: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"{SW_BASE}{path}", headers={"Authorization": f"Bearer {api_key}"})
    data = res.json()
    if res.status_code >= 400 or data.get("error"):
        raise SplitwiseError(data.get("error") or f"Splitwise API error ({res.status_code})", res.status_code)
    return data


async def _post_form(api_key: str, path: str, form: dict) -> dict:
    body = urllib.parse.urlencode(form)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{SW_BASE}{path}",
            content=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    data = res.json()
    errors = data.get("errors")
    if res.status_code >= 400 or (errors and any(errors.values() if isinstance(errors, dict) else errors)):
        message = " ".join(str(v) for vs in errors.values() for v in vs) if isinstance(errors, dict) and errors else None
        raise SplitwiseError(message or data.get("error") or "Splitwise rejected the request.", res.status_code or 400)
    return data


async def get_groups(api_key: str) -> list[dict]:
    data = await _get(api_key, "/get_groups")
    return data.get("groups") or []


async def get_current_user(api_key: str) -> dict:
    data = await _get(api_key, "/get_current_user")
    return data["user"]


async def get_friends(api_key: str) -> list[dict]:
    data = await _get(api_key, "/get_friends")
    return data.get("friends") or []


async def get_categories(api_key: str) -> list[dict]:
    data = await _get(api_key, "/get_categories")
    return data.get("categories") or []


async def get_expenses(api_key: str, dated_after: str | None, dated_before: str | None, group_id: int | None) -> list[dict]:
    params = {"limit": "500"}
    if dated_after:
        params["dated_after"] = dated_after
    if dated_before:
        params["dated_before"] = dated_before
    if group_id:
        params["group_id"] = str(group_id)
    query = urllib.parse.urlencode(params)
    data = await _get(api_key, f"/get_expenses?{query}")
    return data.get("expenses") or []


async def update_expense_category(api_key: str, expense_id: int, category_id: int) -> dict:
    data = await _post_form(api_key, f"/update_expense/{expense_id}", {"category_id": category_id})
    expenses = data.get("expenses") or []
    return expenses[0] if expenses else {}


async def create_or_update_expense(api_key: str, expense_id: int | None, form: dict) -> dict:
    path = f"/update_expense/{expense_id}" if expense_id else "/create_expense"
    data = await _post_form(api_key, path, form)
    expenses = data.get("expenses") or []
    if not expenses or not expenses[0].get("id"):
        raise SplitwiseError("Splitwise did not confirm the expense was created.", 502)
    return expenses[0]
