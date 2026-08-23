"""Direct port of shared/groqProxy.js — same allowlist, same token cap,
same body-size cap, same Groq->NVIDIA fallback behavior. Auth is no longer
this module's job (the router uses Depends(get_uid), same as every other
protected route) — verifyFirebaseToken.js's check lived inside proxyGroq()
itself only because the old JS adapters had nowhere else to put it.
"""

import json

import httpx

from backend.config import GROQ_API_KEY, NVIDIA_API_KEY

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
# meta/llama-3.2-11b-vision-instruct chosen over the 90b variant for lower
# latency — this only runs when Groq is already rate-limiting us, so
# responsiveness matters more than squeezing out extra accuracy.
NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct"

# Pin to exactly the models this app actually sends (receipt-parser vision
# model + Insights chat model) — signup is open, so "has a valid Firebase
# token" isn't much of a barrier to someone wanting to run arbitrary
# inference on our Groq/NVIDIA quota otherwise.
ALLOWED_MODELS = {"qwen/qwen3.6-27b", "openai/gpt-oss-20b"}
MAX_TOKENS_CAP = 4096
# Receipt/statement images are sent inline as base64, so the body is
# legitimately a few MB — cap generously, only to stop absurd abuse.
MAX_BODY_BYTES = 12 * 1024 * 1024


class ProxyResult:
    def __init__(self, status: int, body_text: str, provider: str | None = None):
        self.status = status
        self.body_text = body_text
        self.provider = provider


async def _call_groq(client: httpx.AsyncClient, api_key: str, body_text: str) -> httpx.Response:
    return await client.post(
        GROQ_URL,
        content=body_text,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )


async def _call_nvidia(client: httpx.AsyncClient, api_key: str, body_text: str) -> httpx.Response:
    # Swap in NVIDIA's model id and drop Groq/qwen-specific params (e.g.
    # reasoning_effort) that NVIDIA's API doesn't know about.
    payload = json.loads(body_text)
    payload.pop("reasoning_effort", None)
    payload["model"] = NVIDIA_MODEL
    return await client.post(
        NVIDIA_URL,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
    )


async def proxy_groq(raw_body: bytes) -> ProxyResult:
    """The client builds the full chat-completions payload (model, messages,
    max_tokens) exactly as before — this just forwards it to Groq with the
    real API key attached server-side, with an automatic NVIDIA fallback on
    429/5xx/network failure.
    """
    if not GROQ_API_KEY:
        return ProxyResult(500, json.dumps({"error": "Server is missing GROQ_API_KEY"}))

    if len(raw_body) > MAX_BODY_BYTES:
        return ProxyResult(413, json.dumps({"error": "Request body too large"}))

    try:
        parsed = json.loads(raw_body or b"{}")
    except json.JSONDecodeError:
        return ProxyResult(400, json.dumps({"error": "Invalid JSON body"}))

    if parsed.get("model") not in ALLOWED_MODELS:
        return ProxyResult(400, json.dumps({"error": "Unsupported model"}))

    max_tokens = parsed.get("max_tokens")
    if not isinstance(max_tokens, (int, float)) or max_tokens > MAX_TOKENS_CAP:
        parsed["max_tokens"] = MAX_TOKENS_CAP

    # Forward the normalized payload rather than the raw body, so the clamp
    # above actually takes effect (and _call_nvidia re-parses this same string).
    body_text = json.dumps(parsed)

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            groq_res = await _call_groq(client, GROQ_API_KEY, body_text)
        except httpx.HTTPError as err:
            # A network-level failure reaching Groq is worth an NVIDIA
            # attempt too, same as the 429/5xx cases below — a dropped
            # connection reads the same as "Groq isn't working right now"
            # from here.
            if NVIDIA_API_KEY:
                try:
                    nvidia_res = await _call_nvidia(client, NVIDIA_API_KEY, body_text)
                    return ProxyResult(nvidia_res.status_code, nvidia_res.text, "nvidia")
                except httpx.HTTPError:
                    pass  # fall through to the original network error below
            return ProxyResult(502, json.dumps({"error": f"Could not reach Groq: {err}"}))

        # 429 (rate-limited) and 5xx (Groq itself erroring/overloaded) both
        # mean "Groq isn't serving this request right now" — worth trying
        # NVIDIA. A 4xx below 429 is deterministic and NVIDIA would fail it
        # the same way, so it isn't worth the extra round trip.
        transient = groq_res.status_code == 429 or groq_res.status_code >= 500
        if not transient or not NVIDIA_API_KEY:
            return ProxyResult(groq_res.status_code, groq_res.text, "groq")

        try:
            nvidia_res = await _call_nvidia(client, NVIDIA_API_KEY, body_text)
        except httpx.HTTPError:
            # Fallback itself failed — surface the original Groq error
            # rather than a fallback-specific one, since that's the actual cause.
            return ProxyResult(groq_res.status_code, groq_res.text, "groq")

        return ProxyResult(nvidia_res.status_code, nvidia_res.text, "nvidia")
