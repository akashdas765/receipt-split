"""FastAPI application entrypoint.

No CORS middleware — /api/* is same-origin on Vercel regardless of Python
vs Node runtime, exactly as the old JS proxies were. The only place
cross-origin-shaped plumbing is needed is local dev, handled by Vite's own
dev-server proxy (see vite.config.js), not FastAPI.
"""

from fastapi import FastAPI

from backend.errors import install_error_handlers
from backend.routers import (
    manual_accounts,
    net_worth,
    notifications,
    plaid_connections,
    receipts,
    source_meta,
    splitwise,
    transactions,
    user,
)
from backend.routers.proxies import groq as groq_proxy_router
from backend.routers.proxies import plaid as plaid_proxy_router

app = FastAPI(title="Truespend API")
install_error_handlers(app)

for router_module in (
    receipts,
    transactions,
    plaid_connections,
    source_meta,
    manual_accounts,
    net_worth,
    notifications,
    user,
    splitwise,
    groq_proxy_router,
    plaid_proxy_router,
):
    app.include_router(router_module.router)


@app.get("/api/health")
def health():
    return {"ok": True}
