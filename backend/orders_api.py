"""Products and orders REST API.

Access: every route needs a logged-in user. Customer users only ever see their own customer's
orders. That rule is part of the SQL WHERE clause of every order query, and an order outside
it returns the same 404 as one that does not exist.

SQL safety: values are always parameters. ORDER BY columns come from whitelists, and the
only other text built at runtime is "?" placeholders.
"""

import sqlite3
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

from api_common import (ORDER_NOT_FOUND, Where, add_date_range, order_by, page_meta, placeholders,
                        scope_to_user)
from auth import get_current_user
from db import contains_pattern, get_db, iso_utc

router = APIRouter(prefix="/api", tags=["orders"])

MAX_PAGE_SIZE = 100
ORDER_STATUSES = ("placed", "confirmed", "packed", "shipped", "delivered", "cancelled")
CLIENT_NETWORKS = ("good", "weak", "offline_sync")
NEXT_STATUS = {"placed": "confirmed", "confirmed": "packed", "packed": "shipped", "shipped": "delivered"}
CANCELLABLE = ("placed", "confirmed", "packed")

PRODUCT_SORTS = {"name": "p.name", "unit_price": "p.unit_price", "stock": "p.stock"}
ORDER_SORTS = {"created_at": "o.created_at", "total": "o.total", "id": "o.id"}

Page = Query(1, ge=1)
PageSize = Query(20, ge=1, le=MAX_PAGE_SIZE)


# --- products ---------------------------------------------------------------------------

@router.get("/products")
def list_products(
    q: str | None = Query(None, max_length=100, description="Part of the product name or SKU"),
    category: str | None = Query(None, max_length=100),
    in_stock: bool | None = Query(None, description="true: stock > 0; false: out of stock"),
    page: int = Page,
    page_size: int = PageSize,
    sort: str | None = Query(None, description="name, unit_price or stock; prefix - for descending"),
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    ordering = order_by(sort, PRODUCT_SORTS, "name", "p.id")
    where = Where()
    if q:
        pattern = contains_pattern(q.strip())
        where.add("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')", pattern, pattern)
    if category:
        where.add("lower(p.category) = lower(?)", category.strip())
    if in_stock is not None:
        where.add("p.stock > 0" if in_stock else "p.stock <= 0")
    total = conn.execute(f"SELECT COUNT(*) FROM products p{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(
        "SELECT p.id, p.sku, p.name, p.category, p.description, p.unit_price, p.stock, p.image_url "
        f"FROM products p{where.sql} ORDER BY {ordering} LIMIT ? OFFSET ?",
        [*where.params, page_size, (page - 1) * page_size],
    ).fetchall()
    return {"items": [dict(r) for r in rows], **page_meta(page, page_size, total)}


# --- reading orders ---------------------------------------------------------------------

ORDER_COLUMNS = (
    "o.id, o.customer_id, c.name AS customer_name, o.order_status, o.client_network, o.total, "
    "o.delivery_note, o.created_at, o.updated_at, "
    "(SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count"
)
ORDER_FROM = "FROM orders o JOIN customers c ON c.id = o.customer_id"


def _items_by_order(conn: sqlite3.Connection, order_ids: list[int]) -> dict[int, list[dict]]:
    """Items for many orders in one query."""
    items: dict[int, list[dict]] = {order_id: [] for order_id in order_ids}
    if not order_ids:
        return items
    for r in conn.execute(
        "SELECT oi.order_id, oi.product_id, p.sku, p.name, oi.quantity, oi.unit_price "
        "FROM order_items oi JOIN products p ON p.id = oi.product_id "
        f"WHERE oi.order_id IN ({placeholders(len(order_ids))}) ORDER BY oi.order_id, oi.id",
        order_ids,
    ):
        items[r["order_id"]].append({"product_id": r["product_id"], "sku": r["sku"], "name": r["name"],
                                     "quantity": r["quantity"], "unit_price": r["unit_price"]})
    return items


def _order_json(r: sqlite3.Row, items: list[dict]) -> dict:
    return {
        "id": r["id"],
        "customer": {"id": r["customer_id"], "name": r["customer_name"]},
        "order_status": r["order_status"],
        "client_network": r["client_network"],
        "total": r["total"],
        "delivery_note": r["delivery_note"],
        "created_at": iso_utc(r["created_at"]),
        "updated_at": iso_utc(r["updated_at"]),
        "item_count": r["item_count"],
        "items": items,
    }


def load_order(conn: sqlite3.Connection, order_id: int, user) -> dict | None:
    """The full order as the user may see it, or None (missing or not theirs)."""
    where = Where()
    where.add("o.id = ?", order_id)
    scope_to_user(where, user)
    row = conn.execute(
        f"SELECT {ORDER_COLUMNS}, a.label, a.line1, a.city, a.state, a.pincode, "
        "(SELECT COUNT(*) FROM order_messages m WHERE m.order_id = o.id) AS message_count, "
        "(SELECT COUNT(*) FROM issues i WHERE i.order_id = o.id) AS issue_count, "
        "(SELECT COUNT(*) FROM attachments t WHERE t.order_id = o.id) AS attachment_count, "
        "EXISTS (SELECT 1 FROM order_feedback f WHERE f.order_id = o.id) AS has_feedback "
        f"{ORDER_FROM} LEFT JOIN customer_addresses a ON a.id = o.address_id{where.sql}",
        where.params,
    ).fetchone()
    if row is None:
        return None
    order = _order_json(row, _items_by_order(conn, [row["id"]])[row["id"]])
    order["address"] = None if row["label"] is None else {
        "label": row["label"], "line1": row["line1"], "city": row["city"], "state": row["state"],
        "pincode": row["pincode"]}
    order["events"] = [
        {"from_status": e["from_status"], "to_status": e["to_status"], "changed_by_name": e["full_name"],
         "created_at": iso_utc(e["created_at"])}
        for e in conn.execute(
            "SELECT e.from_status, e.to_status, u.full_name, e.created_at FROM order_events e "
            "JOIN users u ON u.id = e.changed_by WHERE e.order_id = ? ORDER BY e.created_at, e.id",
            (row["id"],))
    ]
    order["counts"] = {"messages": row["message_count"], "issues": row["issue_count"],
                       "attachments": row["attachment_count"]}
    order["has_feedback"] = bool(row["has_feedback"])
    return order


@dataclass
class OrderFilters:
    id: int | None
    customer: str | None
    product: str | None
    status: str | None
    client_network: str | None
    from_: str | None
    to: str | None
    page: int
    page_size: int
    sort: str | None


def order_filters(
    id: int | None = Query(None, ge=1),
    customer: str | None = Query(None, max_length=200, description="Part of the customer name (ops only)"),
    product: str | None = Query(None, max_length=200, description="Part of a product name or SKU on the order"),
    status: str | None = Query(None, max_length=200, description="One status or a comma-separated list"),
    client_network: Literal["good", "weak", "offline_sync"] | None = None,
    from_: str | None = Query(None, alias="from", description="Earliest created date, YYYY-MM-DD"),
    to: str | None = Query(None, description="Latest created date, YYYY-MM-DD (inclusive)"),
    page: int = Page,
    page_size: int = PageSize,
    sort: str | None = Query(None, description="created_at, total or id; prefix - for descending"),
) -> OrderFilters:
    """The order list's query parameters, shared by /api/orders and /api/customers/{id}/orders."""
    return OrderFilters(id, customer, product, status, client_network, from_, to, page, page_size, sort)


def query_orders(conn: sqlite3.Connection, user, f: OrderFilters, customer_id: int | None = None) -> dict:
    """A page of orders the user may see, optionally limited to one customer."""
    ordering = order_by(f.sort, ORDER_SORTS, "-created_at", "o.id")
    where = Where()
    scope_to_user(where, user)
    if customer_id is not None:
        where.add("o.customer_id = ?", customer_id)
    if f.id is not None:
        where.add("o.id = ?", f.id)
    if f.customer and user["role"] == "ops":  # customers are already scoped to themselves
        where.add("c.name LIKE ? ESCAPE '\\'", contains_pattern(f.customer.strip()))
    if f.product:
        pattern = contains_pattern(f.product.strip())
        where.add("EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id "
                  "WHERE oi.order_id = o.id AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\'))",
                  pattern, pattern)
    if f.status:
        statuses = [s.strip() for s in f.status.split(",") if s.strip()]
        unknown = [s for s in statuses if s not in ORDER_STATUSES]
        if unknown or not statuses:
            raise HTTPException(422, f"status must be one or more of: {', '.join(ORDER_STATUSES)} (comma-separated)")
        where.add(f"o.order_status IN ({placeholders(len(statuses))})", *statuses)
    if f.client_network:
        where.add("o.client_network = ?", f.client_network)
    add_date_range(where, "o.created_at", f.from_, f.to)

    total = conn.execute(f"SELECT COUNT(*) {ORDER_FROM}{where.sql}", where.params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {ORDER_COLUMNS} {ORDER_FROM}{where.sql} ORDER BY {ordering} LIMIT ? OFFSET ?",
        [*where.params, f.page_size, (f.page - 1) * f.page_size],
    ).fetchall()
    items = _items_by_order(conn, [r["id"] for r in rows])
    return {"items": [_order_json(r, items[r["id"]]) for r in rows], **page_meta(f.page, f.page_size, total)}


@router.get("/orders")
def list_orders(filters: OrderFilters = Depends(order_filters), user=Depends(get_current_user),
                conn: sqlite3.Connection = Depends(get_db)) -> dict:
    return query_orders(conn, user, filters)


@router.get("/orders/{order_id}")
def get_order(order_id: int, user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)) -> dict:
    order = load_order(conn, order_id, user)
    if order is None:
        raise HTTPException(404, ORDER_NOT_FOUND)
    return order


# --- creating orders --------------------------------------------------------------------

class OrderItemIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=1000)


class OrderCreate(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1, max_length=100)
    delivery_note: str | None = Field(None, max_length=500)
    address_id: int | None = None
    client_network: Literal["good", "weak", "offline_sync"] = "good"
    customer_id: int | None = Field(None, description="Required for ops users, ignored for customers")


def _find_by_idempotency_key(conn: sqlite3.Connection, user_id: int, key: str) -> int | None:
    row = conn.execute("SELECT id FROM orders WHERE placed_by = ? AND idempotency_key = ?", (user_id, key)).fetchone()
    return row[0] if row else None


def _order_customer_id(conn: sqlite3.Connection, user, requested: int | None) -> int:
    if user["role"] != "ops":
        return user["customer_id"]  # a customer always orders for themselves
    if requested is None:
        raise HTTPException(422, "customer_id is required when an ops user places an order")
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (requested,)).fetchone() is None:
        raise HTTPException(422, f"Unknown customer_id {requested}")
    return requested


def _order_address_id(conn: sqlite3.Connection, customer_id: int, requested: int | None) -> int | None:
    if requested is not None:
        row = conn.execute("SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?",
                           (requested, customer_id)).fetchone()
        if row is None:
            raise HTTPException(422, f"address_id {requested} is not one of this customer's addresses")
        return row[0]
    row = conn.execute("SELECT id FROM customer_addresses WHERE customer_id = ? AND is_default = 1 "
                       "ORDER BY id LIMIT 1", (customer_id,)).fetchone()
    return row[0] if row else None


def _replay(conn: sqlite3.Connection, order_id: int, user, response: Response) -> dict:
    response.status_code = 200
    return load_order(conn, order_id, user)


@router.post("/orders", status_code=201)
def create_order(
    body: OrderCreate,
    response: Response,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key", min_length=1, max_length=100),
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    product_ids = [item.product_id for item in body.items]
    duplicates = sorted({pid for pid in product_ids if product_ids.count(pid) > 1})
    if duplicates:
        raise HTTPException(422, f"Each product may appear only once per order; repeated product_id: "
                                 f"{', '.join(map(str, duplicates))}")

    # A retry of a request we already handled: return the original, create nothing.
    if idempotency_key and (existing := _find_by_idempotency_key(conn, user["id"], idempotency_key)):
        return _replay(conn, existing, user, response)

    # IMMEDIATE takes the write lock now, so the stock we check is the stock we update.
    conn.execute("BEGIN IMMEDIATE")
    try:
        if idempotency_key and (existing := _find_by_idempotency_key(conn, user["id"], idempotency_key)):
            conn.rollback()
            return _replay(conn, existing, user, response)

        customer_id = _order_customer_id(conn, user, body.customer_id)
        address_id = _order_address_id(conn, customer_id, body.address_id)
        products = {r["id"]: r for r in conn.execute(
            f"SELECT id, sku, unit_price, stock FROM products WHERE id IN ({placeholders(len(product_ids))})",
            product_ids)}
        unknown = [pid for pid in product_ids if pid not in products]
        if unknown:
            raise HTTPException(422, f"Unknown product_id: {', '.join(map(str, unknown))}")
        short = [f"{products[i.product_id]['sku']} (requested {i.quantity}, in stock {products[i.product_id]['stock']})"
                 for i in body.items if products[i.product_id]["stock"] < i.quantity]
        if short:
            raise HTTPException(422, f"Not enough stock for {'; '.join(short)}")

        total = round(sum(products[i.product_id]["unit_price"] * i.quantity for i in body.items), 2)
        order_id = conn.execute(
            "INSERT INTO orders (customer_id, placed_by, address_id, order_status, total, delivery_note, "
            "client_network, idempotency_key) VALUES (?, ?, ?, 'placed', ?, ?, ?, ?)",
            (customer_id, user["id"], address_id, total, body.delivery_note, body.client_network, idempotency_key),
        ).lastrowid
        conn.executemany(
            "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
            [(order_id, i.product_id, i.quantity, products[i.product_id]["unit_price"]) for i in body.items],
        )
        conn.execute("INSERT INTO order_events (order_id, from_status, to_status, changed_by) "
                     "VALUES (?, NULL, 'placed', ?)", (order_id, user["id"]))
        for item in body.items:
            updated = conn.execute("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
                                   (item.quantity, item.product_id, item.quantity)).rowcount
            if updated != 1:
                raise HTTPException(422, f"Not enough stock for {products[item.product_id]['sku']}")
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        # The unique index caught a concurrent request with the same key: return that order.
        if idempotency_key and (existing := _find_by_idempotency_key(conn, user["id"], idempotency_key)):
            return _replay(conn, existing, user, response)
        raise
    except BaseException:
        conn.rollback()
        raise
    return load_order(conn, order_id, user)


# --- changing order status --------------------------------------------------------------

class StatusChange(BaseModel):
    order_status: Literal["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"]


def _allowed_next(current: str) -> list[str]:
    return [s for s in (NEXT_STATUS.get(current), "cancelled" if current in CANCELLABLE else None) if s]


@router.put("/orders/{order_id}")
def update_order_status(
    order_id: int,
    body: StatusChange,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    target = body.order_status
    is_ops = user["role"] == "ops"
    conn.execute("BEGIN IMMEDIATE")
    try:
        where = Where()
        where.add("o.id = ?", order_id)
        scope_to_user(where, user)
        row = conn.execute(f"SELECT o.order_status FROM orders o{where.sql}", where.params).fetchone()
        if row is None:
            raise HTTPException(404, ORDER_NOT_FOUND)
        current = row["order_status"]

        if not is_ops and target != "cancelled":
            raise HTTPException(403, "Customers can only cancel orders; other status changes are made by ops")
        if target not in _allowed_next(current):
            allowed = ", ".join(_allowed_next(current)) or "none"
            raise HTTPException(422, f"Cannot change an order from {current} to {target}. "
                                     f"Allowed next status: {allowed}")
        if not is_ops and current != "placed":
            raise HTTPException(403, f"Customers can only cancel an order while it is placed; this order is {current}")

        conn.execute("UPDATE orders SET order_status = ?, updated_at = datetime('now') WHERE id = ?",
                     (target, order_id))
        conn.execute("INSERT INTO order_events (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)",
                     (order_id, current, target, user["id"]))
        if target == "cancelled":
            conn.execute(
                "UPDATE products SET stock = stock + (SELECT SUM(oi.quantity) FROM order_items oi "
                "WHERE oi.order_id = ? AND oi.product_id = products.id) "
                "WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?)",
                (order_id, order_id))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return load_order(conn, order_id, user)
