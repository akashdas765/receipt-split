"""POST /api/proxy/plaid — replaces api/plaid.js / netlify/functions/plaid.js.
Same {action, ...payload} body shape src/services/plaid.js already sends;
uid (from the verified Firebase token, not the request body) is passed as
Plaid's client_user_id so a Link session is always tied to the actual
caller, never spoofable via the body.
"""

from fastapi import APIRouter, Depends, Request, Response

from backend.deps.auth import get_uid
from backend.services.plaid_proxy import proxy_plaid

router = APIRouter(prefix="/api/proxy", tags=["proxy"])


@router.post("/plaid")
async def plaid_proxy_route(request: Request, uid: str = Depends(get_uid)):
    raw_body = await request.body()
    result = await proxy_plaid(uid, raw_body)
    return Response(content=result.body_text, status_code=result.status, media_type="application/json")
