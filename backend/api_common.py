"""Helpers shared by the REST routers: WHERE building, customer scoping, sorting and paging.

SQL text built here only ever comes from constants or whitelists; values go in as parameters.
"""

import re
import sqlite3
from datetime import date, timedelta

from fastapi import HTTPException

ORDER_NOT_FOUND = "Order not found"


class Where:
    """WHERE clauses (constant SQL text) and their parameters."""

    def __init__(self):
        self.clauses: list[str] = []
        self.params: list = []

    def add(self, clause: str, *params) -> None:
        self.clauses.append(clause)
        self.params.extend(params)

    @property
    def sql(self) -> str:
        return " WHERE " + " AND ".join(self.clauses) if self.clauses else ""


def placeholders(n: int) -> str:
    return ",".join("?" * n)


def scope_to_user(where: Where, user, alias: str = "o") -> None:
    """Customers only see their own customer's orders (and what hangs off them). Ops see everything."""
    if user["role"] != "ops":
        where.add(f"{alias}.customer_id = ?", user["customer_id"])


def order_by(sort: str | None, allowed: dict[str, str], default: str, tiebreak: str) -> str:
    """Turn 'field' or '-field' into ORDER BY text using only whitelisted expressions."""
    sort = (sort or default).strip()
    descending = sort.startswith("-")
    field = sort[1:] if descending else sort
    if field not in allowed:
        raise HTTPException(422, f"sort must be one of: {', '.join(allowed)} (prefix with - for descending)")
    direction = "DESC" if descending else "ASC"
    return f"{allowed[field]} {direction}, {tiebreak} {direction}"


def page_meta(page: int, page_size: int, total: int) -> dict:
    return {"page": page, "page_size": page_size, "total": total}


def visible_order(conn: sqlite3.Connection, order_id: int, user) -> sqlite3.Row:
    """The order if this user may see it; otherwise the same 404 whether it is missing or not theirs."""
    where = Where()
    where.add("o.id = ?", order_id)
    scope_to_user(where, user)
    row = conn.execute(f"SELECT o.id, o.customer_id, o.order_status FROM orders o{where.sql}", where.params).fetchone()
    if row is None:
        raise HTTPException(404, ORDER_NOT_FOUND)
    return row


def require_customer(user, action: str) -> None:
    if user["role"] != "customer":
        raise HTTPException(403, f"Only customers can {action}")


def parse_date(name: str, value: str | None) -> date | None:
    """A YYYY-MM-DD query parameter, or a 422 with a clear message."""
    if value is None:
        return None
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"{name} must be a date in YYYY-MM-DD format, for example 2026-10-01") from None


def add_date_range(where: Where, column: str, from_value: str | None, to_value: str | None) -> None:
    """Inclusive from/to dates (YYYY-MM-DD) on a stored 'YYYY-MM-DD HH:MM:SS' column."""
    start, end = parse_date("from", from_value), parse_date("to", to_value)
    if start and end and start > end:
        raise HTTPException(422, "from must be on or before to")
    if start:
        where.add(f"{column} >= ?", f"{start.isoformat()} 00:00:00")
    if end:
        where.add(f"{column} < ?", f"{(end + timedelta(days=1)).isoformat()} 00:00:00")
