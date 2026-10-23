"""Login, signed session cookies and role checks.

The session cookie holds only the user id, signed (not encrypted) with SESSION_SECRET via
itsdangerous. itsdangerous adds a timestamp, which is how sessions expire after 8 hours.
"""

import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, Field

from db import get_db

SESSION_COOKIE = "orderwave_session"
SESSION_MAX_AGE = 8 * 60 * 60  # seconds
SESSION_SALT = "orderwave.session"
MIN_SECRET_LENGTH = 32

INVALID_CREDENTIALS = "Invalid email or password"
TOO_MANY_ATTEMPTS = "Too many attempts, try again later"

# Checked against when the email is unknown, so both cases take about as long.
_DUMMY_HASH = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt())

PUBLIC_USER_COLUMNS = "id, email, full_name, role, customer_id"


@dataclass(frozen=True)
class SessionSettings:
    serializer: URLSafeTimedSerializer
    cookie_secure: bool


def make_serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt=SESSION_SALT)


def load_session_settings() -> SessionSettings:
    """Read SESSION_SECRET and COOKIE_SECURE. Raises RuntimeError so the app refuses to start."""
    secret = os.environ.get("SESSION_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        problem = "is not set" if not secret else f"is shorter than {MIN_SECRET_LENGTH} characters"
        raise RuntimeError(
            f"SESSION_SECRET {problem}. Set it to a random value of at least {MIN_SECRET_LENGTH} characters, "
            'for example: python -c "import secrets; print(secrets.token_hex(32))"'
        )
    secure = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
    return SessionSettings(serializer=make_serializer(secret), cookie_secure=secure)


class LoginRateLimiter:
    """In-memory, per-process count of failed logins per email in a sliding window."""

    def __init__(self, max_failures: int = 5, window_seconds: int = 600, clock=time.monotonic):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.clock = clock
        self._failures: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str) -> deque:
        failures = self._failures[key]
        cutoff = self.clock() - self.window_seconds
        while failures and failures[0] <= cutoff:
            failures.popleft()
        return failures

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            failures = self._prune(key)
            blocked = len(failures) >= self.max_failures
            if not failures:
                del self._failures[key]
            return blocked

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._prune(key).append(self.clock())

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._failures.clear()
            else:
                self._failures.pop(key, None)


login_limiter = LoginRateLimiter()


def _password_matches(password: str, stored_hash: str | None) -> bool:
    """Always runs one bcrypt check, even for unknown users or over-long passwords."""
    candidate = password.encode("utf-8")
    usable = stored_hash is not None and len(candidate) <= 72  # bcrypt only takes 72 bytes
    target = stored_hash.encode("ascii") if stored_hash is not None else _DUMMY_HASH
    matched = bcrypt.checkpw(candidate if len(candidate) <= 72 else b"", target)
    return usable and matched


def _public_user(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "email": row["email"], "full_name": row["full_name"],
            "role": row["role"], "customer_id": row["customer_id"]}


def get_current_user(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    """The logged-in user (without password_hash), or 401."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    settings: SessionSettings = request.app.state.session
    try:
        data = settings.serializer.loads(token, max_age=SESSION_MAX_AGE)  # SignatureExpired is a BadSignature
        user_id = int(data["uid"])
    except (BadSignature, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Not authenticated")
    row = conn.execute(f"SELECT {PUBLIC_USER_COLUMNS} FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return row


def require_ops(user: sqlite3.Row = Depends(get_current_user)) -> sqlite3.Row:
    if user["role"] != "ops":
        raise HTTPException(status_code=403, detail="Ops access required")
    return user


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response,
          conn: sqlite3.Connection = Depends(get_db)) -> dict:
    email = body.email.strip().lower()
    if login_limiter.is_blocked(email):
        raise HTTPException(status_code=429, detail=TOO_MANY_ATTEMPTS)

    row = conn.execute(
        f"SELECT {PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()
    if not _password_matches(body.password, row["password_hash"] if row else None):
        login_limiter.record_failure(email)
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)

    login_limiter.reset(email)
    settings: SessionSettings = request.app.state.session
    response.set_cookie(
        SESSION_COOKIE, settings.serializer.dumps({"uid": row["id"]}),
        max_age=SESSION_MAX_AGE, httponly=True, samesite="lax", secure=settings.cookie_secure, path="/",
    )
    return _public_user(row)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    settings: SessionSettings = request.app.state.session
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)
    return {"ok": True}


@router.get("/me")
def me(user: sqlite3.Row = Depends(get_current_user)) -> dict:
    return _public_user(user)
