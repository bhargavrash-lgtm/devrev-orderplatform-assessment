"""SQLite connection helpers. Plain sqlite3, no ORM."""

import os
import sqlite3
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = BACKEND_DIR / "schema.sql"
DEFAULT_DB_PATH = BACKEND_DIR / "data.db"


def db_path() -> Path:
    """Database file location. ORDERWAVE_DB_PATH overrides the default backend/data.db."""
    return Path(os.environ.get("ORDERWAVE_DB_PATH", DEFAULT_DB_PATH))


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI may open the connection in one worker thread and use it
    # in another. Each request still gets its own connection (see get_db).
    conn = sqlite3.connect(path or db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """FastAPI dependency: one connection per request, closed afterwards."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def init_db(path: str | Path | None = None) -> None:
    """Create any missing tables, indexes and views, and switch to WAL. Safe to call on every startup.

    WAL lets readers (including the read-only MCP connection) see the last committed data
    while a write is in progress, instead of waiting for it. The setting is stored in the file.
    """
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    finally:
        conn.close()


def contains_pattern(text: str) -> str:
    """LIKE pattern for 'contains text' with %, _ and \\ escaped. Use with ESCAPE '\\'."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def iso_utc(ts: str | None) -> str | None:
    """'YYYY-MM-DD HH:MM:SS' (UTC, as stored) -> 'YYYY-MM-DDTHH:MM:SSZ'. Dates pass through."""
    if ts is None or len(ts) <= 10:
        return ts
    return ts.replace(" ", "T") + "Z"
