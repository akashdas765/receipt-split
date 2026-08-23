"""Centralized environment-variable reads for the backend.

Kept in one place rather than scattered `os.environ.get()` calls so it's
obvious at a glance what the whole backend needs configured (mirrors
mobile/.env.example's role for the frontend/JS proxies it's replacing).
"""

import base64
import json
import os

from dotenv import load_dotenv

# Loads mobile/.env for local `uvicorn` runs. On Vercel, real env vars are
# already present in the process — load_dotenv() is a no-op there (it never
# overrides an existing os.environ value by default), so this is safe to
# call unconditionally.
load_dotenv()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY")

PLAID_CLIENT_ID = os.environ.get("PLAID_CLIENT_ID")
PLAID_SECRET = os.environ.get("PLAID_SECRET")
PLAID_ENV = os.environ.get("PLAID_ENV", "sandbox")


def firebase_service_account() -> dict:
    """Decodes the base64-encoded Firebase service account JSON.

    A single env var (not a JSON file on disk) because Vercel's filesystem
    isn't a reliable place to ship a secret key file. Generate this value
    via Firebase Console -> Project Settings -> Service Accounts ->
    Generate new private key, then `base64 -i key.json | tr -d '\\n'`.
    """
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_B64")
    if not raw:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_B64 is not set")
    return json.loads(base64.b64decode(raw))
