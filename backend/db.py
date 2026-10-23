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
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: str | Path | None = None) -> None:
    """Create any missing tables and indexes. Safe to call on every startup."""
    conn = connect(path)
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    finally:
        conn.close()
