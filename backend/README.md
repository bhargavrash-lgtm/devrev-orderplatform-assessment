# Backend

FastAPI app with a plain SQLite database (`sqlite3`, parameterised queries, no ORM). Needs Python 3.11+.

## Setup

From the `backend/` folder:

```bash
python -m venv .venv
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# macOS / Linux:        source .venv/bin/activate
pip install -r requirements.txt
```

## Environment variables

The seed reads the demo passwords from the environment and exits if they are missing. See `../.env.example` for the full list.

```bash
# macOS / Linux
export SEED_OPS_PASSWORD='choose-a-password'
export SEED_CUSTOMER_PASSWORD='choose-another-password'
```

```powershell
# Windows PowerShell
$env:SEED_OPS_PASSWORD = 'choose-a-password'
$env:SEED_CUSTOMER_PASSWORD = 'choose-another-password'
```

The database file is `backend/data.db`. Set `ORDERWAVE_DB_PATH` to use a different file.

### Session settings

- `SESSION_SECRET` signs the login cookie. It must be at least 32 characters, or the server refuses to start. Generate one with:

  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```

  Changing it logs everyone out.
- `COOKIE_SECURE`: set to `true` in production so the cookie is only sent over HTTPS. Leave it unset or `false` for `http://localhost`.

```bash
# macOS / Linux
export SESSION_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export COOKIE_SECURE=false
```

```powershell
# Windows PowerShell
$env:SESSION_SECRET = python -c "import secrets; print(secrets.token_hex(32))"
$env:COOKIE_SECURE = 'false'
```

## Seed the database

```bash
python seed.py
```

This creates the tables and views from `schema.sql` if needed, then adds 2 customers (with contacts, addresses and 20 account interactions), 4 users (2 ops, 2 customer), 20 products, 25 orders with status history, 14 order messages, 12 issues, 13 feedback ratings and 12 product reviews. Both ops users (`ops@` and `accounts@orderwave.demo`) use `SEED_OPS_PASSWORD`. It is safe to run again: if data already exists it does nothing.

There are no migrations. When `schema.sql` changes, delete `data.db` and run the seed again.

The demo data has patterns worth finding:

- Duplicate orders: orders placed from the rural sites are queued offline and synced later. The customer retries in the meantime, so the order goes through twice. This happens 3 times at Sundaram Agro and once at Greenfield Seeds. `orders.client_network` is `offline_sync` on every duplicate and its original, and two of the issues are linked to Jira (SCRUM-24, SCRUM-25).
- Wrong items: all 3 `wrong_item` issues are tomato seed SD-TOM-AR01 arriving as okra seed. The product reviews of that SKU say the same.
- Delays: all 3 `delay` issues are Greenfield orders in Pune.
- Feedback: the low ratings match the orders that have issues.
- Account health: Sundaram Agro (enterprise, `at_risk`) starts positive, turns negative after the duplicates, and ends with a negative escalation and renewal call. Greenfield stays mostly positive.

`customer_summary` and `customer_timeline` are views that roll this up per customer.

## Run the server

```bash
uvicorn main:app --reload
```

The app checks `SESSION_SECRET` and creates any missing tables on startup. Check it with:

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok"}
```

When `MCP_API_KEY` is set (32+ characters), the same server also serves the read-only MCP endpoint at `/mcp`. Without it, `/mcp` returns 404 and a warning is logged at startup. See "Connecting an external AI platform" in the root README. The tools live in `mcp_server.py`, and their queries in `mcp_tools.py`.

## Authentication

- `POST /api/auth/login` takes `{"email", "password"}`. It sets a signed, HTTP-only, SameSite=Lax session cookie that holds only the user id and lasts 8 hours, and returns `{id, email, full_name, role, customer_id}`. A wrong password and an unknown email both return 401 `{"error": "Invalid email or password"}`. After 5 failed attempts for one email within 10 minutes, it returns 429 until the window passes. The counter is kept in memory, per process.
- `POST /api/auth/logout` clears the cookie.
- `GET /api/auth/me` returns the current user, or 401.

Routes protect themselves with the dependencies in `auth.py`: `get_current_user` (401 without a valid session) and `require_ops` (403 unless the role is `ops`). Every error response has the shape `{"error": "message"}`.

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"sundaram@orderwave.demo","password":"<SEED_CUSTOMER_PASSWORD>"}' \
  http://127.0.0.1:8000/api/auth/login
curl -b cookies.txt http://127.0.0.1:8000/api/auth/me
```

## Tests

```bash
pytest
```

The tests build a temporary database and seed it, so they never touch `data.db`. They read `SEED_OPS_PASSWORD`, `SEED_CUSTOMER_PASSWORD` and `SESSION_SECRET` from the environment, and use random values for any that aren't set.
