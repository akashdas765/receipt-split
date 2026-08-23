"""POST /api/proxy/groq — replaces api/groq.js / netlify/functions/groq.js.
Raw pass-through: the client sends the exact Groq chat-completions payload,
gets back Groq's (or NVIDIA's, on fallback) raw JSON response body and
status code unchanged, plus an X-Ai-Provider header noting which one served
it — src/services/groq.js reads that header today and must keep working
identically once it's pointed at this URL instead.
"""

from fastapi import APIRouter, Depends, Request, Response

from backend.deps.auth import get_uid
from backend.services.groq_proxy import proxy_groq

router = APIRouter(prefix="/api/proxy", tags=["proxy"])


@router.post("/groq")
async def groq_proxy_route(request: Request, uid: str = Depends(get_uid)):
    raw_body = await request.body()
    result = await proxy_groq(raw_body)
    headers = {"X-Ai-Provider": result.provider} if result.provider else {}
    return Response(content=result.body_text, status_code=result.status, media_type="application/json", headers=headers)
