from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

import mcp_server
from auth import load_session_settings
from auth import router as auth_router
from customers_api import router as customers_router
from db import BACKEND_DIR, init_db
from orders_api import router as orders_router
from records_api import MAX_UPLOAD_BYTES, ensure_uploads_dir
from records_api import router as records_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session = load_session_settings()  # refuses to start without a usable SESSION_SECRET
    init_db()
    ensure_uploads_dir()
    async with AsyncExitStack() as stack:
        # /mcp is only served when MCP_API_KEY is set; otherwise it answers 404.
        app.state.mcp_app = None
        key = mcp_server.load_api_key()
        if key:
            mcp_app = mcp_server.build_http_app(key)
            await stack.enter_async_context(mcp_server.server.session_manager.run())
            app.state.mcp_app = mcp_app
        yield


app = FastAPI(title="OrderWave Order Platform", lifespan=lifespan)


@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    """Refuse oversized uploads before the multipart body is read (the route checks again)."""
    if request.method == "POST" and request.url.path.endswith("/attachments"):
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_UPLOAD_BYTES + 64 * 1024:  # room for multipart headers
            return JSONResponse({"error": "File is larger than 5 MB"}, status_code=413)
    return await call_next(request)


# Every error response has the shape {"error": "message"}.
@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    problems = []
    for err in exc.errors():
        field = ".".join(str(part) for part in err.get("loc", ()) if part != "body")
        problems.append(f"{field}: {err['msg']}" if field else err["msg"])
    return JSONResponse({"error": "; ".join(problems) or "Invalid request"}, status_code=422)


app.include_router(auth_router)
app.include_router(orders_router)
app.include_router(records_router)
app.include_router(customers_router)
app.add_route("/mcp", mcp_server.McpEndpoint(), include_in_schema=False)
# Product images only: this one folder, read-only, no directory listing. Nothing else under /static,
# and never the uploads folder (attachments are downloaded through /api/attachments/{id}).
app.mount("/static/products", StaticFiles(directory=BACKEND_DIR / "static" / "products", html=False),
          name="product-images")


@app.get("/api/health")
def health():
    return {"status": "ok"}
