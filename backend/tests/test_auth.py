import os
import time
from unittest import mock

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

import auth
import seed as seed_module
from db import connect, init_db
from main import app

# A route that only exists in tests, to exercise require_ops.
_test_router = APIRouter()


@_test_router.get("/api/test/ops-only")
def _ops_only(user=Depends(auth.require_ops)):
    return {"ok": True, "role": user["role"]}


if not any(getattr(r, "path", None) == "/api/test/ops-only" for r in app.routes):
    app.include_router(_test_router)

USERS = {
    "ops@orderwave.demo": ("ops", False),
    "accounts@orderwave.demo": ("ops", False),
    "sundaram@orderwave.demo": ("customer", True),
    "greenfield@orderwave.demo": ("customer", True),
}
INVALID = {"error": "Invalid email or password"}


@pytest.fixture
def db_path(tmp_path, monkeypatch, ops_password, customer_password):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))
    init_db(path)
    conn = connect(path)
    seed_module.seed(conn, ops_password, customer_password)
    conn.close()
    return path


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def password_for(email: str) -> str:
    role, _ = USERS[email]
    return os.environ["SEED_OPS_PASSWORD" if role == "ops" else "SEED_CUSTOMER_PASSWORD"]


def login(client, email, password=None):
    return client.post("/api/auth/login", json={"email": email, "password": password or password_for(email)})


def user_id(db_path, email):
    conn = connect(db_path)
    try:
        return conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()[0]
    finally:
        conn.close()


def make_cookie(user_id, age_seconds=0, secret=None):
    serializer = auth.make_serializer(secret or os.environ["SESSION_SECRET"])
    with mock.patch("itsdangerous.timed.time.time", return_value=time.time() - age_seconds):
        return serializer.dumps({"uid": user_id})


def set_session_cookie(client, value):
    """Replace the session cookie (clearing first, so a cookie from login isn't sent alongside)."""
    client.cookies.clear()
    client.cookies.set(auth.SESSION_COOKIE, value)


def assert_no_secrets(response):
    assert "password_hash" not in response.text
    assert "$2b$" not in response.text


@pytest.mark.parametrize("email", list(USERS))
def test_login_succeeds_for_each_seeded_user(client, db_path, email):
    response = login(client, email)
    assert response.status_code == 200, response.text
    body = response.json()
    role, has_customer = USERS[email]
    assert set(body) == {"id", "email", "full_name", "role", "customer_id"}
    assert body["email"] == email and body["role"] == role
    assert (body["customer_id"] is not None) == has_customer
    if has_customer:
        conn = connect(db_path)
        expected = conn.execute(
            "SELECT u.customer_id FROM users u WHERE u.email = ?", (email,)).fetchone()[0]
        conn.close()
        assert body["customer_id"] == expected
    assert_no_secrets(response)


def test_login_email_is_case_insensitive(client):
    assert login(client, "sundaram@orderwave.demo").status_code == 200
    response = client.post("/api/auth/login", json={
        "email": "  Sundaram@OrderWave.demo ", "password": password_for("sundaram@orderwave.demo")})
    assert response.status_code == 200


def test_session_cookie_flags_and_contents(client, db_path):
    response = login(client, "sundaram@orderwave.demo")
    header = response.headers["set-cookie"]
    assert header.startswith(f"{auth.SESSION_COOKIE}=")
    assert "HttpOnly" in header and "SameSite=lax" in header and "Max-Age=28800" in header
    assert "Secure" not in header
    token = client.cookies[auth.SESSION_COOKIE]
    payload = auth.make_serializer(os.environ["SESSION_SECRET"]).loads(token)
    assert payload == {"uid": user_id(db_path, "sundaram@orderwave.demo")}


def test_secure_flag_when_cookie_secure_true(db_path, monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "true")
    with TestClient(app) as c:
        response = login(c, "ops@orderwave.demo")
    assert "Secure" in response.headers["set-cookie"]


def test_wrong_password_and_unknown_email_look_the_same(client):
    wrong = login(client, "sundaram@orderwave.demo", password="not-the-password")
    unknown = client.post("/api/auth/login", json={"email": "nobody@orderwave.demo", "password": "whatever"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == INVALID
    assert auth.SESSION_COOKIE not in wrong.headers.get("set-cookie", "")


def test_unknown_email_still_runs_bcrypt(client):
    with mock.patch.object(auth.bcrypt, "checkpw", wraps=auth.bcrypt.checkpw) as checkpw:
        response = client.post("/api/auth/login", json={"email": "nobody@orderwave.demo", "password": "x"})
    assert response.status_code == 401
    assert checkpw.call_count == 1


def test_overlong_password_is_rejected_without_error(client):
    response = login(client, "sundaram@orderwave.demo", password=password_for("sundaram@orderwave.demo") + "x" * 100)
    assert response.status_code == 401 and response.json() == INVALID


def test_me_with_and_without_session(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401 and response.json() == {"error": "Not authenticated"}

    login(client, "greenfield@orderwave.demo")
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == "greenfield@orderwave.demo"
    assert response.json()["role"] == "customer"
    assert_no_secrets(response)


def test_logout_ends_the_session(client):
    login(client, "ops@orderwave.demo")
    assert client.get("/api/auth/me").status_code == 200
    response = client.post("/api/auth/logout")
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert f'{auth.SESSION_COOKIE}=""' in response.headers["set-cookie"] or "Max-Age=0" in response.headers["set-cookie"]
    assert client.get("/api/auth/me").status_code == 401


def test_require_ops(client):
    assert client.get("/api/test/ops-only").status_code == 401

    login(client, "sundaram@orderwave.demo")
    response = client.get("/api/test/ops-only")
    assert response.status_code == 403 and response.json() == {"error": "Ops access required"}

    client.post("/api/auth/logout")
    login(client, "accounts@orderwave.demo")
    response = client.get("/api/test/ops-only")
    assert response.status_code == 200 and response.json() == {"ok": True, "role": "ops"}


def test_expired_cookie_is_rejected(client, db_path):
    uid = user_id(db_path, "ops@orderwave.demo")
    set_session_cookie(client, make_cookie(uid, age_seconds=60 * 60))
    assert client.get("/api/auth/me").status_code == 200  # control: 1 hour old is fine

    set_session_cookie(client, make_cookie(uid, age_seconds=auth.SESSION_MAX_AGE + 60))
    response = client.get("/api/auth/me")
    assert response.status_code == 401 and response.json() == {"error": "Not authenticated"}


def test_tampered_cookie_is_rejected(client, db_path):
    login(client, "sundaram@orderwave.demo")
    token = client.cookies[auth.SESSION_COOKIE]
    tampered = token[:2] + ("A" if token[2] != "A" else "B") + token[3:]
    set_session_cookie(client, tampered)
    assert client.get("/api/auth/me").status_code == 401

    # A cookie for the ops user signed with a different secret.
    forged = make_cookie(user_id(db_path, "ops@orderwave.demo"), secret="x" * 64)
    set_session_cookie(client, forged)
    assert client.get("/api/auth/me").status_code == 401


def test_session_for_deleted_user_is_rejected(client, db_path):
    login(client, "greenfield@orderwave.demo")
    conn = connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DELETE FROM users WHERE email = 'greenfield@orderwave.demo'")
    conn.commit()
    conn.close()
    assert client.get("/api/auth/me").status_code == 401


def test_sixth_failed_attempt_is_rate_limited(client):
    email = "sundaram@orderwave.demo"
    for _ in range(5):
        assert login(client, email, password="wrong-password").status_code == 401
    response = login(client, email, password="wrong-password")
    assert response.status_code == 429
    assert response.json() == {"error": "Too many attempts, try again later"}
    # Still blocked with the right password, and other users are unaffected.
    assert login(client, email).status_code == 429
    assert login(client, "greenfield@orderwave.demo").status_code == 200


def test_successful_login_clears_failures(client):
    email = "greenfield@orderwave.demo"
    for _ in range(4):
        login(client, email, password="wrong-password")
    assert login(client, email).status_code == 200
    for _ in range(5):
        assert login(client, email, password="wrong-password").status_code == 401


def test_rate_limit_window_expires():
    now = [1000.0]
    limiter = auth.LoginRateLimiter(max_failures=5, window_seconds=600, clock=lambda: now[0])
    for _ in range(5):
        limiter.record_failure("a@example.com")
    assert limiter.is_blocked("a@example.com")
    now[0] += 601
    assert not limiter.is_blocked("a@example.com")


def test_app_refuses_to_start_without_session_secret(db_path, monkeypatch):
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="SESSION_SECRET is not set"):
        with TestClient(app):
            pass


def test_app_refuses_to_start_with_short_session_secret(db_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "too-short")
    with pytest.raises(RuntimeError, match="shorter than 32 characters"):
        with TestClient(app):
            pass


def test_errors_use_one_shape(client):
    response = client.post("/api/auth/login", json={"email": "ops@orderwave.demo"})
    assert response.status_code == 422
    assert response.json() == {"error": "password: Field required"}

    response = client.post("/api/auth/login", content="not json", headers={"content-type": "application/json"})
    assert response.status_code == 422 and set(response.json()) == {"error"}

    response = client.get("/api/does-not-exist")
    assert response.status_code == 404 and response.json() == {"error": "Not Found"}

    response = client.get("/api/auth/login")
    assert response.status_code == 405 and set(response.json()) == {"error"}
