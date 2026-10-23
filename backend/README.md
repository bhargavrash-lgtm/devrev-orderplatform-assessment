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

This creates the tables from `schema.sql` if needed, then adds 2 customers, 3 users, 20 products, 25 orders with status history, order messages and issues. It is safe to run again: if data already exists it does nothing. To start over, delete `data.db` and run it again.

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
