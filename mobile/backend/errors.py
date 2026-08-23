"""Global exception handling — every error response is `{"error": "..."}`.

Every existing frontend service file (splitwise.js, groq.js, plaid.js, and
every db.js caller) checks `data?.error` on a failed response. FastAPI's
default error body is `{"detail": ...}` — matching the old shape here,
once, is what keeps the Stage 3 frontend rewrite a data-source swap
instead of also being an error-handling rewrite.
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("truespend")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=400, content={"error": "Invalid request"})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        # Full detail server-side only — never leak internals to the client,
        # same principle the old verifyFirebaseToken.js applied to auth
        # failures specifically, generalized here to every unhandled error.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"error": "Unexpected server error"})
