from datetime import datetime, timezone

import bcrypt
import pytest

import seed as seed_module
from db import connect, init_db

OPS_PASSWORD = "ops-test-password"
CUSTOMER_PASSWORD = "customer-test-password"

TABLES = ["customers", "users", "products", "orders", "order_items", "order_events",
          "issues", "order_messages", "attachments", "ai_requests"]


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
    assert counts["issues"] == 6
    assert counts["attachments"] == 0
    assert counts["ai_requests"] == 0

    roles = dict(conn.execute("SELECT role, COUNT(*) FROM users GROUP BY role").fetchall())
    assert roles == {"ops": 1, "customer": 2}
    assert conn.execute("SELECT COUNT(DISTINCT category) FROM products").fetchone()[0] == 4

    items_per_order = [r[0] for r in conn.execute("SELECT COUNT(*) FROM order_items GROUP BY order_id")]
    assert len(items_per_order) == 25
    assert all(1 <= n <= 4 for n in items_per_order)

    assert conn.execute("SELECT COUNT(DISTINCT order_id) FROM order_messages").fetchone()[0] == 8
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
        assert len(roles) >= 2
        assert all(a != b for a, b in zip(roles, roles[1:])), f"order {order_id}: {roles}"


def test_issues(conn):
    rows = conn.execute(
        "SELECT i.category, i.severity, i.status, c.name AS customer "
        "FROM issues i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id"
    ).fetchall()
    duplicate = [r for r in rows if r["category"] == "duplicate_order"]
    assert len(duplicate) == 1 and duplicate[0]["customer"] == "Sundaram Agro Distributors"
    assert any(r["category"] == "delay" for r in rows)
    assert len({r["severity"] for r in rows}) == 3
    assert len({r["status"] for r in rows}) == 3


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
