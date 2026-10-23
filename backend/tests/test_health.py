from fastapi.testclient import TestClient

from db import connect
from main import app


def test_health_creates_db_and_returns_ok(tmp_path, monkeypatch):
    path = tmp_path / "health.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    conn = connect(path)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    views = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'view'")}
    conn.close()
    assert views == {"customer_summary", "customer_timeline"}
    assert {"customers", "users", "products", "orders", "order_items", "order_events",
            "issues", "order_messages", "attachments", "order_feedback", "customer_contacts",
            "customer_addresses", "customer_interactions", "product_reviews"} <= tables
    assert "ai_requests" not in tables
