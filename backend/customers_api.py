"""Customer master, account history and insights.

Everything here is internal to ops, except GET /api/customer, which gives a customer user
their own basic profile. Customers never see interactions, the timeline, sentiment, the
account owner, contract value, renewal date, status, tier, summary numbers or other customers.
"""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from api_common import Where, add_date_range, order_by, page_meta, placeholders
from auth import get_current_user, require_ops
from db import contains_pattern, get_db, iso_utc
from orders_api import OrderFilters, order_filters, query_orders

router = APIRouter(prefix="/api", tags=["customers"])

MAX_PAGE_SIZE = 100
MAX_TIMELINE_PAGE_SIZE = 200
INTERACTION_TYPES = ("call", "email", "meeting", "note", "escalation", "renewal")
TIMELINE_EVENT_TYPES = ("order", "issue", "message", "feedback") + INTERACTION_TYPES
UNRESOLVED = ("open", "investigating")
RISK_WINDOW_DAYS = 90
RISK_NEGATIVE_INTERACTIONS = 2

CUSTOMER_SORTS = {
    "name": "c.name",
    "lifetime_value": "s.lifetime_value",
    "last_order_at": "s.last_order_at",
    "unresolved_issues": "s.unresolved_issues",
    "avg_rating": "s.avg_rating",
}
CUSTOMER_COLUMNS = (
    "c.id, c.customer_code, c.name, c.industry, c.tier, c.region, c.city, c.state, c.account_owner_id, "
    "owner.full_name AS owner_name, c.annual_contract_value, c.renewal_date, c.status, c.customer_since, "
    "c.contact_email, s.order_count, s.lifetime_value, s.last_order_at, s.unresolved_issues, s.open_issues_only, "
    "s.investigating_issues, s.total_issues, s.avg_rating, s.negative_interactions, s.last_interaction_at"
)
CUSTOMER_FROM = ("FROM customers c JOIN customer_summary s ON s.customer_id = c.id "
                 "LEFT JOIN users owner ON owner.id = c.account_owner_id")

InteractionType = Literal["call", "email", "meeting", "note", "escalation", "renewal"]
Sentiment = Literal["positive", "neutral", "negative"]


def _customer_json(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "customer_code": r["customer_code"], "name": r["name"], "industry": r["industry"],
        "tier": r["tier"], "region": r["region"], "city": r["city"], "state": r["state"],
        "account_owner": None if r["account_owner_id"] is None else {"id": r["account_owner_id"],
                                                                     "name": r["owner_name"]},
        "annual_contract_value": r["annual_contract_value"], "currency": "INR", "renewal_date": r["renewal_date"],
        "status": r["status"], "customer_since": r["customer_since"], "contact_email": r["contact_email"],
        "summary": {
            "order_count": r["order_count"], "lifetime_value": r["lifetime_value"],
            "last_order_at": iso_utc(r["last_order_at"]), "unresolved_issues": r["unresolved_issues"],
            "open_issues_only": r["open_issues_only"], "investigating_issues": r["investigating_issues"],
            "total_issues": r["total_issues"], "avg_rating": r["avg_rating"],
            "negative_interactions": r["negative_interactions"],
            "last_interaction_at": iso_utc(r["last_interaction_at"]),
        },
    }


def _addresses(conn: sqlite3.Connection, customer_id: int) -> list[dict]:
    return [dict(r) | {"is_default": bool(r["is_default"])} for r in conn.execute(
        "SELECT id, label, line1, city, state, pincode, is_default FROM customer_addresses WHERE customer_id = ? "
        "ORDER BY is_default DESC, id", (customer_id,))]


def _customer_exists(conn: sqlite3.Connection, customer_id: int) -> None:
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:
        raise HTTPException(404, "Customer not found")


# --- customer's own profile -------------------------------------------------------------

@router.get("/customer")
def my_customer(user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    """A customer user's own basic profile. Deliberately leaves out every internal field."""
    if user["role"] != "customer":
        raise HTTPException(403, "This endpoint is for customer users; ops users can use /api/customers")
    row = conn.execute("SELECT id, customer_code, name, city, state FROM customers WHERE id = ?",
                       (user["customer_id"],)).fetchone()
    if row is None:
        raise HTTPException(404, "Customer not found")
    contacts = [{"full_name": r["full_name"], "title": r["title"], "is_primary": bool(r["is_primary"])}
                for r in conn.execute("SELECT full_name, title, is_primary FROM customer_contacts "
                                      "WHERE customer_id = ? ORDER BY is_primary DESC, id", (row["id"],))]
    return {**dict(row), "addresses": _addresses(conn, row["id"]), "contacts": contacts}


# --- customer master (ops) --------------------------------------------------------------

@router.get("/customers")
def list_customers(
    name: str | None = Query(None, max_length=200, description="Part of the customer name"),
    tier: Literal["enterprise", "mid_market", "small"] | None = None,
    status: Literal["active", "at_risk", "churned"] | None = None,
    region: str | None = Query(None, max_length=100),
    account_owner: str | None = Query(None, max_length=200, description="Part of the account owner's name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
    sort: str | None = Query(None, description="name, lifetime_value, last_order_at, unresolved_issues or "
                                                "avg_rating; prefix - for descending"),
    user=Depends(require_ops),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    ordering = order_by(sort, CUSTOMER_SORTS, "name", "c.id")
    where = Where()
    if name:
        where.add("c.name LIKE ? ESCAPE '\\'", contains_pattern(name.strip()))
    if tier:
        where.add("c.tier = ?", tier)
    if status:
        where.add("c.status = ?", status)
    if region:
        where.add("c.region LIKE ? ESCAPE '\\'", contains_pattern(region.strip()))
    if account_owner:
        where.add("owner.full_name LIKE ? ESCAPE '\\'", contains_pattern(account_owner.strip()))
    total = conn.execute(f"SELECT COUNT(*) {CUSTOMER_FROM}{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(f"SELECT {CUSTOMER_COLUMNS} {CUSTOMER_FROM}{where.sql} ORDER BY {ordering} LIMIT ? OFFSET ?",
                        [*where.params, page_size, (page - 1) * page_size]).fetchall()
    return {"items": [_customer_json(r) for r in rows], **page_meta(page, page_size, total)}


@router.get("/customers/{customer_id}")
def get_customer(customer_id: int, user=Depends(require_ops), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    row = conn.execute(f"SELECT {CUSTOMER_COLUMNS} {CUSTOMER_FROM} WHERE c.id = ?", (customer_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Customer not found")
    customer = _customer_json(row)
    customer["contacts"] = [dict(r) | {"is_primary": bool(r["is_primary"])} for r in conn.execute(
        "SELECT id, full_name, title, email, phone, is_primary FROM customer_contacts WHERE customer_id = ? "
        "ORDER BY is_primary DESC, id", (customer_id,))]
    customer["addresses"] = _addresses(conn, customer_id)
    return customer


@router.get("/customers/{customer_id}/orders")
def customer_orders(customer_id: int, filters: OrderFilters = Depends(order_filters), user=Depends(require_ops),
                    conn: sqlite3.Connection = Depends(get_db)) -> dict:
    _customer_exists(conn, customer_id)
    return query_orders(conn, user, filters, customer_id=customer_id)


# --- history (ops) ----------------------------------------------------------------------

@router.get("/customers/{customer_id}/timeline")
def customer_timeline(
    customer_id: int,
    event_types: str | None = Query(None, max_length=200, description="Comma-separated: " + ", ".join(TIMELINE_EVENT_TYPES)),
    from_: str | None = Query(None, alias="from", description="YYYY-MM-DD"),
    to: str | None = Query(None, description="YYYY-MM-DD (inclusive)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=MAX_TIMELINE_PAGE_SIZE),
    user=Depends(require_ops),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    _customer_exists(conn, customer_id)
    where = Where()
    where.add("t.customer_id = ?", customer_id)
    if event_types:
        types = [t.strip() for t in event_types.split(",") if t.strip()]
        if not types or any(t not in TIMELINE_EVENT_TYPES for t in types):
            raise HTTPException(422, f"event_types must be a comma-separated list of: {', '.join(TIMELINE_EVENT_TYPES)}")
        where.add(f"t.event_type IN ({placeholders(len(types))})", *types)
    add_date_range(where, "t.event_at", from_, to)
    total = conn.execute(f"SELECT COUNT(*) FROM customer_timeline t{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(
        f"SELECT t.event_type, t.event_at, t.order_id, t.summary FROM customer_timeline t{where.sql} "
        "ORDER BY t.event_at DESC, t.event_type LIMIT ? OFFSET ?",
        [*where.params, page_size, (page - 1) * page_size]).fetchall()
    items = [{"event_type": r["event_type"], "event_at": iso_utc(r["event_at"]), "order_id": r["order_id"],
              "summary": r["summary"]} for r in rows]
    return {"customer_id": customer_id, "items": items, **page_meta(page, page_size, total)}


INTERACTION_SELECT = ("SELECT x.id, x.customer_id, x.order_id, x.interaction_type, x.summary, x.sentiment, "
                      "u.full_name AS created_by_name, x.created_at "
                      "FROM customer_interactions x JOIN users u ON u.id = x.created_by")


def _interaction_json(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "customer_id": r["customer_id"], "order_id": r["order_id"],
            "interaction_type": r["interaction_type"], "sentiment": r["sentiment"], "summary": r["summary"],
            "created_by_name": r["created_by_name"], "created_at": iso_utc(r["created_at"])}


@router.get("/customers/{customer_id}/interactions")
def list_interactions(
    customer_id: int,
    interaction_type: InteractionType | None = None,
    sentiment: Sentiment | None = None,
    from_: str | None = Query(None, alias="from", description="YYYY-MM-DD"),
    to: str | None = Query(None, description="YYYY-MM-DD (inclusive)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
    user=Depends(require_ops),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    _customer_exists(conn, customer_id)
    where = Where()
    where.add("x.customer_id = ?", customer_id)
    if interaction_type:
        where.add("x.interaction_type = ?", interaction_type)
    if sentiment:
        where.add("x.sentiment = ?", sentiment)
    add_date_range(where, "x.created_at", from_, to)
    total = conn.execute(f"SELECT COUNT(*) FROM customer_interactions x{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(f"{INTERACTION_SELECT}{where.sql} ORDER BY x.created_at DESC, x.id DESC LIMIT ? OFFSET ?",
                        [*where.params, page_size, (page - 1) * page_size]).fetchall()
    return {"items": [_interaction_json(r) for r in rows], **page_meta(page, page_size, total)}


class InteractionIn(BaseModel):
    interaction_type: InteractionType
    summary: str
    sentiment: Sentiment = "neutral"
    order_id: int | None = None

    @field_validator("summary")
    @classmethod
    def _length(cls, value: str) -> str:
        value = value.strip()
        if not 5 <= len(value) <= 2000:
            raise ValueError("summary must be 5 to 2000 characters (not counting surrounding spaces)")
        return value


@router.post("/customers/{customer_id}/interactions", status_code=201)
def log_interaction(customer_id: int, body: InteractionIn, user=Depends(require_ops),
                    conn: sqlite3.Connection = Depends(get_db)) -> dict:
    _customer_exists(conn, customer_id)
    if body.order_id is not None and conn.execute("SELECT 1 FROM orders WHERE id = ? AND customer_id = ?",
                                                  (body.order_id, customer_id)).fetchone() is None:
        raise HTTPException(422, f"order_id {body.order_id} is not an order of this customer")
    with conn:
        interaction_id = conn.execute(
            "INSERT INTO customer_interactions (customer_id, order_id, interaction_type, summary, sentiment, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (customer_id, body.order_id, body.interaction_type, body.summary, body.sentiment, user["id"]),
        ).lastrowid
    return _interaction_json(conn.execute(f"{INTERACTION_SELECT} WHERE x.id = ?", (interaction_id,)).fetchone())


# --- insights (ops) ---------------------------------------------------------------------

def _counts(conn: sqlite3.Connection, sql: str, params=()) -> dict:
    return {r[0]: r[1] for r in conn.execute(sql, params)}


def _customers_at_risk(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT c.id, c.customer_code, c.name, c.status, c.renewal_date, s.unresolved_issues, "
        "(SELECT COUNT(*) FROM customer_interactions x WHERE x.customer_id = c.id AND x.sentiment = 'negative' "
        " AND x.created_at >= datetime('now', ?)) AS recent_negative "
        "FROM customers c JOIN customer_summary s ON s.customer_id = c.id ORDER BY c.name",
        (f"-{RISK_WINDOW_DAYS} days",)).fetchall()
    at_risk = []
    for r in rows:
        reasons = []
        if r["status"] == "at_risk":
            reasons.append("status is at_risk")
        if r["recent_negative"] >= RISK_NEGATIVE_INTERACTIONS:
            reasons.append(f"{r['recent_negative']} negative interactions in the last {RISK_WINDOW_DAYS} days")
        if reasons:
            at_risk.append({"customer_id": r["id"], "customer_code": r["customer_code"], "name": r["name"],
                            "renewal_date": r["renewal_date"], "unresolved_issues": r["unresolved_issues"],
                            "reasons": reasons})
    return at_risk


@router.get("/insights")
def insights(user=Depends(require_ops), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    unresolved = f"i.status IN ({placeholders(len(UNRESOLVED))})"
    feedback_count, feedback_avg = conn.execute("SELECT COUNT(*), ROUND(AVG(rating), 2) FROM order_feedback").fetchone()
    distribution = {str(n): 0 for n in range(1, 6)}
    distribution |= {str(k): v for k, v in _counts(conn, "SELECT rating, COUNT(*) FROM order_feedback GROUP BY rating").items()}

    recurring = []
    for r in conn.execute(
        "SELECT i.category, COUNT(*) AS issue_count, "
        f"SUM(CASE WHEN {unresolved} THEN 1 ELSE 0 END) AS unresolved, "
        "SUM(CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END) AS resolved "
        "FROM issues i GROUP BY i.category HAVING COUNT(*) >= 2 ORDER BY issue_count DESC, i.category",
        UNRESOLVED,
    ).fetchall():
        customers = [c[0] for c in conn.execute(
            "SELECT DISTINCT c.name FROM issues i JOIN orders o ON o.id = i.order_id "
            "JOIN customers c ON c.id = o.customer_id WHERE i.category = ? ORDER BY c.name", (r["category"],))]
        recurring.append({"category": r["category"], "issue_count": r["issue_count"], "unresolved": r["unresolved"],
                          "resolved": r["resolved"], "customers_affected": customers})

    top_customers = [
        {"customer_id": r["customer_id"], "name": r["name"], "unresolved_issues": r["unresolved_issues"],
         "open_issues_only": r["open_issues_only"], "investigating_issues": r["investigating_issues"]}
        for r in conn.execute("SELECT customer_id, name, unresolved_issues, open_issues_only, investigating_issues "
                              "FROM customer_summary WHERE unresolved_issues > 0 "
                              "ORDER BY unresolved_issues DESC, name LIMIT 5")
    ]
    recent_events = [
        {"customer_id": r["customer_id"], "customer_name": r["name"], "event_type": r["event_type"],
         "event_at": iso_utc(r["event_at"]), "order_id": r["order_id"], "summary": r["summary"]}
        for r in conn.execute("SELECT t.customer_id, c.name, t.event_type, t.event_at, t.order_id, t.summary "
                              "FROM customer_timeline t JOIN customers c ON c.id = t.customer_id "
                              "ORDER BY t.event_at DESC, t.event_type LIMIT 10")
    ]
    return {
        "orders_by_status": _counts(conn, "SELECT order_status, COUNT(*) FROM orders GROUP BY order_status"),
        "orders_by_client_network": _counts(conn, "SELECT client_network, COUNT(*) FROM orders GROUP BY client_network"),
        "unresolved_issues_by_category": _counts(
            conn, f"SELECT i.category, COUNT(*) FROM issues i WHERE {unresolved} GROUP BY i.category", UNRESOLVED),
        "unresolved_issues_by_severity": _counts(
            conn, f"SELECT i.severity, COUNT(*) FROM issues i WHERE {unresolved} GROUP BY i.severity", UNRESOLVED),
        "issues_by_status": _counts(conn, "SELECT status, COUNT(*) FROM issues GROUP BY status"),
        "feedback": {"average_rating": feedback_avg, "count": feedback_count, "ratings_distribution": distribution},
        "top_customers_by_unresolved_issues": top_customers,
        "recurring_issues_by_category": recurring,
        "recent_events": recent_events,
        "customers_at_risk": _customers_at_risk(conn),
        "notes": {
            "unresolved": "unresolved means status is open or investigating",
            "recurring_issues_by_category": "categories with at least 2 issues, counting every status",
            "customers_at_risk": f"status at_risk, or at least {RISK_NEGATIVE_INTERACTIONS} negative interactions "
                                 f"in the last {RISK_WINDOW_DAYS} days",
        },
    }
