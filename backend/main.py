from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from auth import load_session_settings
from auth import router as auth_router
from db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session = load_session_settings()  # refuses to start without a usable SESSION_SECRET
    init_db()
    yield


app = FastAPI(title="OrderWave Order Platform", lifespan=lifespan)


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


@app.get("/api/health")
def health():
    return {"status": "ok"}
