"""Direct port of shared/plaidProxy.js — same 4-action allowlist, same
request shaping per action. Pagination (sync's has_more/next_cursor) and
turning Plaid's transaction shape into this app's own stay the CLIENT's
job (src/services/plaid.js) for now, same division of labor the JS proxy
used — this layer exists only to keep PLAID_SECRET out of the browser, not
to encode app-specific logic. (services/plaid_sync.py, planned for Stage 2,
is where that orchestration eventually moves server-side.)
"""

import json
import logging

import httpx

from backend.config import PLAID_CLIENT_ID, PLAID_ENV, PLAID_SECRET

logger = logging.getLogger("truespend")


class PlaidProxyError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def _build_create_link_token(uid: str, payload: dict) -> tuple[str, dict]:
    body = {
        "user": {"client_user_id": uid},
        "client_name": "Truespend",
        "products": ["transactions"],
        "country_codes": ["US"],
        "language": "en",
    }
    # Only OAuth institutions (Chase, Capital One, …) in Production use
    # this — harmless to include for Sandbox, which ignores it.
    if payload.get("redirect_uri"):
        body["redirect_uri"] = payload["redirect_uri"]
    return "/link/token/create", body


def _build_exchange_public_token(uid: str, payload: dict) -> tuple[str, dict]:
    if not payload.get("public_token"):
        raise PlaidProxyError(400, "Missing public_token")
    return "/item/public_token/exchange", {"public_token": payload["public_token"]}


def _build_sync_transactions(uid: str, payload: dict) -> tuple[str, dict]:
    if not payload.get("access_token"):
        raise PlaidProxyError(400, "Missing access_token")
    body = {"access_token": payload["access_token"], "count": 500}
    if payload.get("cursor"):
        body["cursor"] = payload["cursor"]
    return "/transactions/sync", body


def _build_get_accounts(uid: str, payload: dict) -> tuple[str, dict]:
    if not payload.get("access_token"):
        raise PlaidProxyError(400, "Missing access_token")
    return "/accounts/get", {"access_token": payload["access_token"]}


ACTIONS = {
    "create_link_token": _build_create_link_token,
    "exchange_public_token": _build_exchange_public_token,
    "sync_transactions": _build_sync_transactions,
    "get_accounts": _build_get_accounts,
}


class ProxyResult:
    def __init__(self, status: int, body_text: str):
        self.status = status
        self.body_text = body_text


async def proxy_plaid(uid: str, raw_body: bytes) -> ProxyResult:
    if not PLAID_CLIENT_ID or not PLAID_SECRET:
        return ProxyResult(500, json.dumps({"error": "Server is missing PLAID_CLIENT_ID/PLAID_SECRET"}))

    # Trial-plan/production both use the production API host — Plaid
    # retired the separate "development" environment in favor of the Trial
    # plan (real data, free, capped at 10 connected Items). Sandbox is fake
    # test data.
    plaid_base = "https://production.plaid.com" if PLAID_ENV == "production" else "https://sandbox.plaid.com"

    try:
        payload = json.loads(raw_body or b"{}")
    except json.JSONDecodeError:
        return ProxyResult(400, json.dumps({"error": "Invalid JSON body"}))

    build = ACTIONS.get(payload.get("action"))
    if not build:
        return ProxyResult(400, json.dumps({"error": f"Unknown action: {payload.get('action')}"}))

    try:
        path, plaid_body = build(uid, payload)
    except PlaidProxyError as err:
        return ProxyResult(err.status_code, json.dumps({"error": str(err)}))

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            plaid_res = await client.post(
                f"{plaid_base}{path}",
                json={"client_id": PLAID_CLIENT_ID, "secret": PLAID_SECRET, **plaid_body},
            )
    except httpx.HTTPError as err:
        return ProxyResult(502, json.dumps({"error": f"Could not reach Plaid: {err}"}))

    if plaid_res.status_code >= 400:
        # Logged server-side only (never sent to the client, never logs the
        # secret) — Plaid's client-facing error messages don't say *why*
        # credentials were rejected, so this at least confirms which
        # action/host/env was involved when it's not obvious from the message.
        logger.error(
            "Plaid %s failed (%s) against %s, PLAID_ENV=%s, client_id length=%s: %s",
            payload.get("action"), plaid_res.status_code, plaid_base,
            PLAID_ENV or "(unset)", len(PLAID_CLIENT_ID), plaid_res.text,
        )

    return ProxyResult(plaid_res.status_code, plaid_res.text)
