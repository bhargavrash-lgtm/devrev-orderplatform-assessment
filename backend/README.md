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

The app creates any missing tables on startup. Check it with:

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok"}
```

## Tests

```bash
pytest
```

The tests build a temporary database and seed it, so they never touch `data.db`.
