import sqlite3
from datetime import datetime, timezone

import bcrypt
import pytest

import seed as seed_module
from db import connect, init_db

OPS_PASSWORD = "ops-test-password"
CUSTOMER_PASSWORD = "customer-test-password"

TABLES = ["customers", "users", "products", "orders", "order_items", "order_events",
          "issues", "order_messages", "attachments", "order_feedback"]


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "test.db"
    init_db(path)
    c = connect(path)
    assert seed_module.seed(c, OPS_PASSWORD, CUSTOMER_PASSWORD) is True
    yield c
    c.close()


def row_counts(c):
    return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}


def test_row_counts(conn):
    counts = row_counts(conn)
    assert counts["customers"] == 2
    assert counts["users"] == 3
    assert counts["products"] == 20
    assert counts["orders"] == 25
    assert counts["issues"] == 12
    assert counts["order_messages"] == 14
    assert counts["order_feedback"] == 13
    assert counts["attachments"] == 0

    roles = dict(conn.execute("SELECT role, COUNT(*) FROM users GROUP BY role").fetchall())
    assert roles == {"ops": 1, "customer": 2}
    assert conn.execute("SELECT COUNT(DISTINCT category) FROM products").fetchone()[0] == 4

    items_per_order = [r[0] for r in conn.execute("SELECT COUNT(*) FROM order_items GROUP BY order_id")]
    assert len(items_per_order) == 25
    assert all(1 <= n <= 4 for n in items_per_order)

    statuses = {r[0] for r in conn.execute("SELECT DISTINCT order_status FROM orders")}
    assert statuses == {"placed", "confirmed", "packed", "shipped", "delivered", "cancelled"}


def test_order_totals_match_items(conn):
    rows = conn.execute(
        "SELECT o.id, o.total, SUM(i.quantity * i.unit_price) AS items_sum "
        "FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY o.id"
    ).fetchall()
    assert len(rows) == 25
    for r in rows:
        assert r["total"] == pytest.approx(r["items_sum"], abs=0.01), f"order {r['id']}"


def test_foreign_keys_resolve(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    # Customer users belong to a customer, the ops user does not.
    assert conn.execute(
        "SELECT COUNT(*) FROM users WHERE (role = 'customer') != (customer_id IS NOT NULL)"
    ).fetchone()[0] == 0
    # Each order was placed by a user of the same customer.
    assert conn.execute(
        "SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.placed_by WHERE u.customer_id != o.customer_id"
    ).fetchone()[0] == 0


def test_event_history_matches_status(conn):
    now = datetime.now(timezone.utc).strftime(seed_module.TS_FORMAT)
    for order in conn.execute("SELECT id, order_status, created_at, updated_at FROM orders"):
        events = conn.execute(
            "SELECT from_status, to_status, created_at FROM order_events WHERE order_id = ? ORDER BY id",
            (order["id"],),
        ).fetchall()
        assert events[0]["from_status"] is None and events[0]["to_status"] == "placed"
        assert events[0]["created_at"] == order["created_at"]
        for prev, cur in zip(events, events[1:]):
            assert cur["from_status"] == prev["to_status"]
            assert cur["created_at"] >= prev["created_at"]
        assert events[-1]["to_status"] == order["order_status"]
        assert events[-1]["created_at"] == order["updated_at"] <= now


def test_messages_alternate_customer_and_ops(conn):
    for (order_id,) in conn.execute("SELECT DISTINCT order_id FROM order_messages"):
        roles = [r[0] for r in conn.execute(
            "SELECT u.role FROM order_messages m JOIN users u ON u.id = m.author_id "
            "WHERE m.order_id = ? ORDER BY m.id", (order_id,))]
        assert all(a != b for a, b in zip(roles, roles[1:])), f"order {order_id}: {roles}"


def test_issues(conn):
    rows = conn.execute(
        "SELECT i.order_id, i.category, i.severity, i.status, i.jira_key, c.name AS customer "
        "FROM issues i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id"
    ).fetchall()
    by_category = {}
    for r in rows:
        by_category.setdefault(r["category"], []).append(r)
    assert {k: len(v) for k, v in by_category.items()} == {
        "duplicate_order": 4, "wrong_item": 3, "delay": 3, "damaged": 1, "billing": 1}
    assert len({r["customer"] for r in rows}) == 2
    assert len({r["severity"] for r in rows}) == 3
    assert len({r["status"] for r in rows}) == 3

    duplicates = by_category["duplicate_order"]
    assert len(duplicates) >= 3
    assert sorted(r["customer"] for r in duplicates) == [
        "Greenfield Seeds Co-op"] + ["Sundaram Agro Distributors"] * 3
    assert sorted(r["jira_key"] for r in rows if r["jira_key"]) == ["SCRUM-24", "SCRUM-25"]
    assert all(r["jira_key"] is None for r in rows if r["category"] != "duplicate_order")

    # Every wrong_item issue is about the same SKU.
    wrong_item_orders = [r["order_id"] for r in by_category["wrong_item"]]
    common = None
    for order_id in wrong_item_orders:
        skus = {s for (s,) in conn.execute(
            "SELECT p.sku FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ?",
            (order_id,))}
        common = skus if common is None else common & skus
    assert common == {"SD-TOM-AR01"}


def test_duplicate_orders_match_an_earlier_order(conn):
    """Each duplicate_order issue sits on a retry: same customer and items as an order placed just before."""
    def items(order_id):
        return sorted(tuple(r) for r in conn.execute(
            "SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,)))

    for issue in conn.execute(
        "SELECT o.id, o.customer_id, o.created_at FROM issues i JOIN orders o ON o.id = i.order_id "
        "WHERE i.category = 'duplicate_order'"
    ).fetchall():
        earlier = conn.execute(
            "SELECT id FROM orders WHERE customer_id = ? AND id != ? AND created_at <= ? "
            "AND created_at >= datetime(?, '-30 minutes')",
            (issue["customer_id"], issue["id"], issue["created_at"], issue["created_at"]),
        ).fetchall()
        assert any(items(e["id"]) == items(issue["id"]) for e in earlier), f"order {issue['id']}"


def test_feedback(conn):
    assert conn.execute(
        "SELECT COUNT(*) FROM (SELECT order_id FROM order_feedback GROUP BY order_id HAVING COUNT(*) > 1)"
    ).fetchone()[0] == 0
    rows = conn.execute(
        "SELECT f.rating, f.comment, f.created_at, f.user_id, o.order_status, o.updated_at, u.customer_id, "
        "o.customer_id AS order_customer FROM order_feedback f "
        "JOIN orders o ON o.id = f.order_id JOIN users u ON u.id = f.user_id"
    ).fetchall()
    assert all(r["order_status"] == "delivered" for r in rows)
    assert all(r["customer_id"] == r["order_customer"] for r in rows)
    assert all(r["created_at"] >= r["updated_at"] for r in rows)
    assert all(r["comment"] for r in rows)

    ratings = [r["rating"] for r in rows]
    assert sum(r <= 2 for r in ratings) == 4
    assert sum(r == 3 for r in ratings) == 3
    assert sum(r >= 4 for r in ratings) == 6
    assert {1, 5} <= set(ratings)

    delivered = conn.execute("SELECT COUNT(*) FROM orders WHERE order_status = 'delivered'").fetchone()[0]
    assert len(rows) > delivered / 2

    # A second row for the same order is rejected by the UNIQUE constraint.
    order_id, user_id = conn.execute("SELECT order_id, user_id FROM order_feedback LIMIT 1").fetchone()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO order_feedback (order_id, user_id, rating) VALUES (?, ?, 4)", (order_id, user_id))


def test_passwords_are_bcrypt_hashed(conn):
    hashes = dict(conn.execute("SELECT email, password_hash FROM users").fetchall())
    assert bcrypt.checkpw(OPS_PASSWORD.encode(), hashes["ops@orderwave.demo"].encode())
    for email in ("sundaram@orderwave.demo", "greenfield@orderwave.demo"):
        assert bcrypt.checkpw(CUSTOMER_PASSWORD.encode(), hashes[email].encode())
    assert OPS_PASSWORD not in hashes.values()


def test_seed_twice_does_not_duplicate(conn):
    before = row_counts(conn)
    assert seed_module.seed(conn, OPS_PASSWORD, CUSTOMER_PASSWORD) is False
    assert row_counts(conn) == before


def test_cli_is_idempotent(tmp_path, monkeypatch, capsys):
    path = tmp_path / "cli.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))
    monkeypatch.setenv("SEED_OPS_PASSWORD", OPS_PASSWORD)
    monkeypatch.setenv("SEED_CUSTOMER_PASSWORD", CUSTOMER_PASSWORD)

    seed_module.main()
    c = connect(path)
    first = row_counts(c)
    seed_module.main()
    assert row_counts(c) == first
    c.close()
    assert "nothing to do" in capsys.readouterr().out


def test_missing_passwords_exit_with_message(monkeypatch):
    monkeypatch.delenv("SEED_OPS_PASSWORD", raising=False)
    monkeypatch.setenv("SEED_CUSTOMER_PASSWORD", CUSTOMER_PASSWORD)
    with pytest.raises(SystemExit) as exc:
        seed_module.read_passwords()
    assert "SEED_OPS_PASSWORD" in str(exc.value)
