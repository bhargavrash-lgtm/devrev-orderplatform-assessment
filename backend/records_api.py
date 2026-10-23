"""Order conversation, issues, feedback, product reviews and attachments.

Same access rule as the orders API: customers only reach records on their own customer's
orders. The rule is in each query's WHERE clause, and anything outside it is the same 404 as
something that does not exist.
"""

import os
import re
import secrets
import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from api_common import Where, order_by, page_meta, placeholders, require_customer, scope_to_user, visible_order
from auth import get_current_user, require_ops
from db import BACKEND_DIR, contains_pattern, get_db, iso_utc

router = APIRouter(prefix="/api", tags=["records"])

MAX_PAGE_SIZE = 100
ISSUE_CATEGORIES = ("delay", "wrong_item", "damaged", "duplicate_order", "billing", "other")
ISSUE_STATUS_FILTERS = {
    "unresolved": ("open", "investigating"),
    "open": ("open",),
    "investigating": ("investigating",),
    "resolved": ("resolved",),
    "all": ("open", "investigating", "resolved"),
}
ISSUE_SORTS = {
    "created_at": "i.created_at",
    "severity": "CASE i.severity WHEN 'low' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
    "status": "CASE i.status WHEN 'open' THEN 1 WHEN 'investigating' THEN 2 ELSE 3 END",
}
JIRA_KEY = re.compile(r"^[A-Z][A-Z0-9]+-[0-9]+$")

Category = Literal["delay", "wrong_item", "damaged", "duplicate_order", "billing", "other"]
Severity = Literal["low", "medium", "high"]
IssueStatus = Literal["open", "investigating", "resolved"]


def _trimmed(value: str, field: str, low: int, high: int) -> str:
    value = value.strip()
    if not low <= len(value) <= high:
        raise ValueError(f"{field} must be {low} to {high} characters (not counting surrounding spaces)")
    return value


def _check_jira_key(value: str | None) -> str | None:
    if value is not None and not JIRA_KEY.fullmatch(value):
        raise ValueError("jira_key must look like SCRUM-24 (capital letters/digits, a dash, digits) or be null")
    return value


# --- messages ---------------------------------------------------------------------------

class MessageIn(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def _length(cls, value: str) -> str:
        return _trimmed(value, "body", 1, 2000)


def _message_json(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "order_id": r["order_id"], "author_name": r["full_name"], "author_role": r["role"],
            "body": r["body"], "created_at": iso_utc(r["created_at"])}


MESSAGE_SELECT = ("SELECT m.id, m.order_id, u.full_name, u.role, m.body, m.created_at "
                  "FROM order_messages m JOIN users u ON u.id = m.author_id")


@router.get("/orders/{order_id}/messages")
def list_messages(order_id: int, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
                  user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    total = conn.execute("SELECT COUNT(*) FROM order_messages WHERE order_id = ?", (order_id,)).fetchone()[0]
    rows = conn.execute(f"{MESSAGE_SELECT} WHERE m.order_id = ? ORDER BY m.created_at, m.id LIMIT ? OFFSET ?",
                        (order_id, page_size, (page - 1) * page_size)).fetchall()
    return {"items": [_message_json(r) for r in rows], **page_meta(page, page_size, total)}


@router.post("/orders/{order_id}/messages", status_code=201)
def post_message(order_id: int, body: MessageIn, user=Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    with conn:
        message_id = conn.execute("INSERT INTO order_messages (order_id, author_id, body) VALUES (?, ?, ?)",
                                  (order_id, user["id"], body.body)).lastrowid
    return _message_json(conn.execute(f"{MESSAGE_SELECT} WHERE m.id = ?", (message_id,)).fetchone())


# --- issues -----------------------------------------------------------------------------

ISSUE_SELECT = (
    "SELECT i.id, i.order_id, c.id AS customer_id, c.name AS customer_name, i.category, i.severity, i.status, "
    "i.description, i.jira_key, u.full_name AS reported_by_name, i.created_at "
    "FROM issues i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id "
    "JOIN users u ON u.id = i.reported_by"
)


def _products_by_order(conn: sqlite3.Connection, order_ids: list[int]) -> dict[int, list[dict]]:
    """Products on many orders in one query."""
    products: dict[int, list[dict]] = {order_id: [] for order_id in order_ids}
    if order_ids:
        for r in conn.execute(
            "SELECT oi.order_id, p.id, p.sku, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id "
            f"WHERE oi.order_id IN ({placeholders(len(order_ids))}) ORDER BY oi.order_id, oi.id", order_ids,
        ):
            products[r["order_id"]].append({"product_id": r["id"], "sku": r["sku"], "name": r["name"]})
    return products


def _issues_json(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict]:
    products = _products_by_order(conn, sorted({r["order_id"] for r in rows}))
    return [{"id": r["id"], "order_id": r["order_id"],
             "customer": {"id": r["customer_id"], "name": r["customer_name"]},
             "category": r["category"], "severity": r["severity"], "status": r["status"],
             "description": r["description"], "jira_key": r["jira_key"], "reported_by_name": r["reported_by_name"],
             "created_at": iso_utc(r["created_at"]), "products": products[r["order_id"]]} for r in rows]


def _issue(conn: sqlite3.Connection, issue_id: int) -> dict:
    return _issues_json(conn, conn.execute(f"{ISSUE_SELECT} WHERE i.id = ?", (issue_id,)).fetchall())[0]


class IssueIn(BaseModel):
    category: Category
    severity: Severity = "medium"
    description: str
    jira_key: str | None = None

    @field_validator("description")
    @classmethod
    def _length(cls, value: str) -> str:
        return _trimmed(value, "description", 5, 2000)

    @field_validator("jira_key")
    @classmethod
    def _jira(cls, value: str | None) -> str | None:
        return _check_jira_key(value)


class IssueUpdate(BaseModel):
    status: IssueStatus | None = None
    severity: Severity | None = None
    category: Category | None = None
    jira_key: str | None = None

    @field_validator("jira_key")
    @classmethod
    def _jira(cls, value: str | None) -> str | None:
        return _check_jira_key(value)


@router.get("/orders/{order_id}/issues")
def list_order_issues(order_id: int, user=Depends(get_current_user),
                      conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    rows = conn.execute(f"{ISSUE_SELECT} WHERE i.order_id = ? ORDER BY i.created_at, i.id", (order_id,)).fetchall()
    return {"items": _issues_json(conn, rows)}


@router.post("/orders/{order_id}/issues", status_code=201)
def report_issue(order_id: int, body: IssueIn, user=Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    if body.jira_key is not None and user["role"] != "ops":
        raise HTTPException(403, "Only ops can set jira_key")
    with conn:
        issue_id = conn.execute(
            "INSERT INTO issues (order_id, reported_by, category, severity, status, description, jira_key) "
            "VALUES (?, ?, ?, ?, 'open', ?, ?)",
            (order_id, user["id"], body.category, body.severity, body.description, body.jira_key),
        ).lastrowid
    return _issue(conn, issue_id)


@router.get("/issues")
def list_issues(
    status: Literal["unresolved", "open", "investigating", "resolved", "all"] = Query(
        "unresolved", description="unresolved = open or investigating; open = newly reported, not yet worked on"),
    category: Category | None = None,
    severity: Severity | None = None,
    customer: str | None = Query(None, max_length=200, description="Part of the customer name (ops only)"),
    jira_key: str | None = Query(None, max_length=50),
    order_id: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
    sort: str | None = Query(None, description="created_at, severity or status; prefix - for descending"),
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    ordering = order_by(sort, ISSUE_SORTS, "-created_at", "i.id")
    where = Where()
    scope_to_user(where, user)
    statuses = ISSUE_STATUS_FILTERS[status]
    where.add(f"i.status IN ({placeholders(len(statuses))})", *statuses)
    if category:
        where.add("i.category = ?", category)
    if severity:
        where.add("i.severity = ?", severity)
    if customer and user["role"] == "ops":  # customers are already scoped to themselves
        where.add("c.name LIKE ? ESCAPE '\\'", contains_pattern(customer.strip()))
    if jira_key:
        where.add("upper(i.jira_key) = upper(?)", jira_key.strip())
    if order_id is not None:
        where.add("i.order_id = ?", order_id)
    from_sql = ISSUE_SELECT[ISSUE_SELECT.index(" FROM "):]
    total = conn.execute(f"SELECT COUNT(*){from_sql}{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(f"{ISSUE_SELECT}{where.sql} ORDER BY {ordering} LIMIT ? OFFSET ?",
                        [*where.params, page_size, (page - 1) * page_size]).fetchall()
    return {"status_filter": status, "items": _issues_json(conn, rows), **page_meta(page, page_size, total)}


@router.put("/issues/{issue_id}")
def update_issue(issue_id: int, body: IssueUpdate, user=Depends(require_ops),
                 conn: sqlite3.Connection = Depends(get_db)) -> dict:
    changes = {field: getattr(body, field) for field in body.model_fields_set}
    if not changes:
        raise HTTPException(422, "Give at least one of: status, severity, category, jira_key")
    for field in ("status", "severity", "category"):
        if field in changes and changes[field] is None:
            raise HTTPException(422, f"{field} cannot be null")
    if conn.execute("SELECT 1 FROM issues WHERE id = ?", (issue_id,)).fetchone() is None:
        raise HTTPException(404, "Issue not found")
    # Column names come from this fixed list, never from the request.
    assignments = [f"{column} = ?" for column in ("status", "severity", "category", "jira_key") if column in changes]
    values = [changes[column] for column in ("status", "severity", "category", "jira_key") if column in changes]
    with conn:
        conn.execute(f"UPDATE issues SET {', '.join(assignments)} WHERE id = ?", [*values, issue_id])
    return _issue(conn, issue_id)


# --- order feedback ---------------------------------------------------------------------

class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(None, max_length=1000)


def _feedback_json(r: sqlite3.Row) -> dict:
    return {"order_id": r["order_id"], "rating": r["rating"], "comment": r["comment"],
            "created_at": iso_utc(r["created_at"])}


@router.post("/orders/{order_id}/feedback", status_code=201)
def leave_feedback(order_id: int, body: FeedbackIn, user=Depends(get_current_user),
                   conn: sqlite3.Connection = Depends(get_db)) -> dict:
    require_customer(user, "leave order feedback")
    order = visible_order(conn, order_id, user)
    if order["order_status"] != "delivered":
        raise HTTPException(422, f"Feedback can only be left once the order is delivered; it is {order['order_status']}")
    try:
        with conn:
            conn.execute("INSERT INTO order_feedback (order_id, user_id, rating, comment) VALUES (?, ?, ?, ?)",
                         (order_id, user["id"], body.rating, body.comment))
    except sqlite3.IntegrityError:  # UNIQUE(order_id)
        raise HTTPException(409, "Feedback has already been left for this order") from None
    return _feedback_json(conn.execute("SELECT * FROM order_feedback WHERE order_id = ?", (order_id,)).fetchone())


@router.get("/orders/{order_id}/feedback")
def get_feedback(order_id: int, user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    row = conn.execute("SELECT * FROM order_feedback WHERE order_id = ?", (order_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Feedback not found")
    return _feedback_json(row)


# --- product reviews --------------------------------------------------------------------

class ReviewIn(BaseModel):
    order_id: int
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(None, max_length=1000)


def _product_or_404(conn: sqlite3.Connection, product_id: int) -> None:
    if conn.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is None:
        raise HTTPException(404, "Product not found")


REVIEW_SELECT = ("SELECT r.id, r.product_id, r.order_id, c.name AS customer_name, r.rating, r.comment, r.created_at "
                 "FROM product_reviews r JOIN customers c ON c.id = r.customer_id")


def _review_json(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "product_id": r["product_id"], "order_id": r["order_id"],
            "customer_name": r["customer_name"], "rating": r["rating"], "comment": r["comment"],
            "created_at": iso_utc(r["created_at"])}


@router.post("/products/{product_id}/reviews", status_code=201)
def review_product(product_id: int, body: ReviewIn, user=Depends(get_current_user),
                   conn: sqlite3.Connection = Depends(get_db)) -> dict:
    require_customer(user, "review products")
    _product_or_404(conn, product_id)
    where = Where()
    where.add("o.id = ?", body.order_id)
    scope_to_user(where, user)
    order = conn.execute(f"SELECT o.id, o.order_status FROM orders o{where.sql}", where.params).fetchone()
    if order is None:  # missing or another customer's: same answer
        raise HTTPException(422, f"order_id {body.order_id} is not one of your orders")
    if order["order_status"] != "delivered":
        raise HTTPException(422, f"Order {body.order_id} has not been delivered yet")
    if conn.execute("SELECT 1 FROM order_items WHERE order_id = ? AND product_id = ?",
                    (body.order_id, product_id)).fetchone() is None:
        raise HTTPException(422, f"Order {body.order_id} does not contain this product")
    try:
        with conn:
            review_id = conn.execute(
                "INSERT INTO product_reviews (product_id, customer_id, user_id, order_id, rating, comment) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (product_id, user["customer_id"], user["id"], body.order_id, body.rating, body.comment),
            ).lastrowid
    except sqlite3.IntegrityError:  # UNIQUE(product_id, customer_id, order_id)
        raise HTTPException(409, "You have already reviewed this product for this order") from None
    return _review_json(conn.execute(f"{REVIEW_SELECT} WHERE r.id = ?", (review_id,)).fetchone())


@router.get("/products/{product_id}/reviews")
def list_reviews(product_id: int, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
                 user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    _product_or_404(conn, product_id)
    count, average = conn.execute("SELECT COUNT(*), ROUND(AVG(rating), 2) FROM product_reviews WHERE product_id = ?",
                                  (product_id,)).fetchone()
    rows = conn.execute(f"{REVIEW_SELECT} WHERE r.product_id = ? ORDER BY r.created_at DESC, r.id DESC "
                        "LIMIT ? OFFSET ?", (product_id, page_size, (page - 1) * page_size)).fetchall()
    return {"product_id": product_id, "average_rating": average, "review_count": count,
            "items": [_review_json(r) for r in rows], **page_meta(page, page_size, count)}


# --- attachments ------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
# kind -> (stored content type, allowed extensions)
UPLOAD_KINDS = {
    "png": ("image/png", (".png",)),
    "jpg": ("image/jpeg", (".jpg", ".jpeg")),
    "pdf": ("application/pdf", (".pdf",)),
    "txt": ("text/plain; charset=utf-8", (".txt",)),
}


def uploads_dir() -> Path:
    """Where uploaded files live. ORDERWAVE_UPLOADS_DIR overrides backend/uploads. Never served statically."""
    return Path(os.environ.get("ORDERWAVE_UPLOADS_DIR", BACKEND_DIR / "uploads"))


def ensure_uploads_dir() -> None:
    uploads_dir().mkdir(parents=True, exist_ok=True)


def detect_kind(data: bytes) -> str | None:
    """The file's real type from its content, or None if it is not one we accept."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"%PDF-"):
        return "pdf"
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return "txt" if b"\x00" not in data else None


def sanitise_filename(name: str | None, kind: str) -> str:
    """Keep only the last path part and safe characters. Used for display and downloads only."""
    base = re.split(r"[\\/]", name or "")[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")[:100]
    return base or f"attachment{UPLOAD_KINDS[kind][1][0]}"


def _attachment_json(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "order_id": r["order_id"], "issue_id": r["issue_id"], "filename": r["filename"],
            "content_type": r["content_type"], "size_bytes": r["size_bytes"], "uploaded_by_name": r["full_name"],
            "created_at": iso_utc(r["created_at"])}


ATTACHMENT_SELECT = ("SELECT a.id, a.order_id, a.issue_id, a.filename, a.content_type, a.size_bytes, a.storage_path, "
                     "u.full_name, a.created_at FROM attachments a JOIN users u ON u.id = a.uploaded_by")


@router.post("/orders/{order_id}/attachments", status_code=201)
async def upload_attachment(order_id: int, file: UploadFile = File(...),
                            issue_id: int | None = Form(None), user=Depends(get_current_user),
                            conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    if issue_id is not None and conn.execute("SELECT 1 FROM issues WHERE id = ? AND order_id = ?",
                                             (issue_id, order_id)).fetchone() is None:
        raise HTTPException(422, f"issue_id {issue_id} is not an issue on this order")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 5 MB")
    if not data:
        raise HTTPException(422, "File is empty")
    kind = detect_kind(data)
    extension = Path(sanitise_filename(file.filename, "txt")).suffix.lower()
    if kind is None or extension not in UPLOAD_KINDS[kind][1]:
        raise HTTPException(422, "Only PNG, JPG, PDF and UTF-8 text files are allowed, and the file extension "
                                 "must match the content")
    content_type, extensions = UPLOAD_KINDS[kind]
    filename = sanitise_filename(file.filename, kind)

    ensure_uploads_dir()
    stored_name = secrets.token_hex(16) + extensions[0]  # never the user's filename
    path = uploads_dir() / stored_name
    path.write_bytes(data)
    try:
        with conn:
            attachment_id = conn.execute(
                "INSERT INTO attachments (order_id, issue_id, uploaded_by, filename, content_type, size_bytes, "
                "storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (order_id, issue_id, user["id"], filename, content_type, len(data), stored_name),
            ).lastrowid
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return _attachment_json(conn.execute(f"{ATTACHMENT_SELECT} WHERE a.id = ?", (attachment_id,)).fetchone())


@router.get("/orders/{order_id}/attachments")
def list_attachments(order_id: int, user=Depends(get_current_user),
                     conn: sqlite3.Connection = Depends(get_db)) -> dict:
    visible_order(conn, order_id, user)
    rows = conn.execute(f"{ATTACHMENT_SELECT} WHERE a.order_id = ? ORDER BY a.created_at, a.id", (order_id,)).fetchall()
    return {"items": [_attachment_json(r) for r in rows]}


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: int, user=Depends(get_current_user),
                        conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    where = Where()
    where.add("a.id = ?", attachment_id)
    scope_to_user(where, user)
    row = conn.execute(f"SELECT a.filename, a.content_type, a.storage_path FROM attachments a "
                       f"JOIN orders o ON o.id = a.order_id{where.sql}", where.params).fetchone()
    if row is None:
        raise HTTPException(404, "Attachment not found")
    root = uploads_dir().resolve()
    path = (root / row["storage_path"]).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(404, "Attachment not found")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"],
                        content_disposition_type="attachment", headers={"X-Content-Type-Options": "nosniff"})
