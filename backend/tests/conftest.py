"""Shared test setup.

Passwords and secrets are read from the environment (SEED_OPS_PASSWORD,
SEED_CUSTOMER_PASSWORD, SESSION_SECRET, MCP_API_KEY). Any that are not set get a random value
for this test run, so nothing is hardcoded and the suite still runs without a .env.
"""

import os
import secrets

import pytest

import auth

for _name in ("SEED_OPS_PASSWORD", "SEED_CUSTOMER_PASSWORD"):
    if not os.environ.get(_name):
        os.environ[_name] = secrets.token_urlsafe(16)
if len(os.environ.get("SESSION_SECRET", "")) < auth.MIN_SECRET_LENGTH:
    os.environ["SESSION_SECRET"] = secrets.token_hex(32)
if len(os.environ.get("MCP_API_KEY", "")) < 32:
    os.environ["MCP_API_KEY"] = secrets.token_hex(32)


@pytest.fixture
def ops_password() -> str:
    return os.environ["SEED_OPS_PASSWORD"]


@pytest.fixture
def customer_password() -> str:
    return os.environ["SEED_CUSTOMER_PASSWORD"]


@pytest.fixture(autouse=True)
def _reset_login_limiter():
    auth.login_limiter.reset()
    yield
    auth.login_limiter.reset()
