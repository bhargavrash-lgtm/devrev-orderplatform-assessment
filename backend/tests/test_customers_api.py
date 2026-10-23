import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import seed as seed_module
from db import connect, init_db
from main import app

SUNDARAM = "sundaram@orderwave.demo"
GREENFIELD = "greenfield@orderwave.demo"
OPS = "ops@orderwave.demo"
OPS_ONLY = ["/api/customers", "/api/customers/{id}", "/api/customers/{id}/orders", "/api/customers/{id}/timeline",
            "/api/customers/{id}/interactions", "/api/insights"]


@pytest.fixture
def db_path(tmp_path, monkeypatch, ops_password, customer_password):
    path = tmp_path / "customers.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))
    monkeypatch.setenv("ORDERWAVE_UPLOADS_DIR", str(tmp_path / "uploads"))
    init_db(path)
    conn = connect(path)
    seed_module.seed(conn, ops_password, customer_password)
    conn.close()
    return path


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def login_as(client, email):
    client.cookies.clear()
    var = "SEED_OPS_PASSWORD" if email in (OPS, "accounts@orderwave.demo") else "SEED_CUSTOMER_PASSWORD"
    response = client.post("/api/auth/login", json={"email": email, "password": os.environ[var]})
    assert response.status_code == 200, response.text
    return response.json()


def rows(db_path, sql, params=()):
    conn = connect(db_path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def scalar(db_path, sql, params=()):
    return rows(db_path, sql, params)[0][0]


def cid(db_path, code):
    return scalar(db_path, "SELECT id FROM customers WHERE customer_code = ?", (code,))


# --- access ---------------------------------------------------------------------------

def test_every_route_needs_a_session(client, db_path):
    sun = cid(db_path, "SUN-001")
    for path in ["/api/customer"] + [p.format(id=sun) for p in OPS_ONLY]:
        response = client.get(path)
        assert response.status_code == 401 and response.json() == {"error": "Not authenticated"}, path
    response = client.post(f"/api/customers/{sun}/interactions", json={"interaction_type": "call", "summary": "hello"})
    assert response.status_code == 401


def test_customer_user_is_kept_out_of_internal_routes(client, db_path):
    sun, grn = cid(db_path, "SUN-001"), cid(db_path, "GRN-002")
    login_as(client, SUNDARAM)
    for customer_id in (sun, grn, 999999):  # own, other and missing all look the same
        for path in OPS_ONLY:
            response = client.get(path.format(id=customer_id))
            assert response.status_code == 403 and response.json() == {"error": "Ops access required"}, path
    create = client.post(f"/api/customers/{sun}/interactions",
                         json={"interaction_type": "note", "summary": "Customer writing their own note"})
    assert create.status_code == 403
    assert scalar(db_path, "SELECT COUNT(*) FROM customer_interactions") == 20

    login_as(client, OPS)
    mine = client.get("/api/customer")
    assert mine.status_code == 403 and "for customer users" in mine.json()["error"]


def test_own_profile_has_no_internal_fields(client, db_path):
    login_as(client, SUNDARAM)
    response = client.get("/api/customer")
    assert response.status_code == 200
    profile = response.json()
    assert set(profile) == {"id", "customer_code", "name", "city", "state", "addresses", "contacts"}
    assert (profile["customer_code"], profile["name"], profile["city"]) == \
        ("SUN-001", "Sundaram Agro Distributors", "Bengaluru")
    assert all(set(c) == {"full_name", "title", "is_primary"} for c in profile["contacts"])
    assert sum(c["is_primary"] for c in profile["contacts"]) == 1
    assert {a["label"] for a in profile["addresses"]} == {"Bengaluru warehouse", "Hosakote field office"}
    assert sum(a["is_default"] for a in profile["addresses"]) == 1

    text = response.text.lower()
    secrets_in_db = rows(db_path, "SELECT annual_contract_value, renewal_date, tier, status, contact_email "
                                  "FROM customers WHERE customer_code = 'SUN-001'")[0]
    for forbidden in ("@", "+91", "4200000", secrets_in_db["renewal_date"], "enterprise", "at_risk", "rohan",
                      "account_owner", "interaction", "sentiment", "summary", "negative", "contract", "tier"):
        assert str(forbidden).lower() not in text, forbidden

    login_as(client, GREENFIELD)
    assert client.get("/api/customer").json()["customer_code"] == "GRN-002"


# --- customer master ------------------------------------------------------------------

def test_customer_list_filters_and_sort(client, db_path):
    login_as(client, OPS)
    body = client.get("/api/customers").json()
    assert body["total"] == 2 and [c["name"] for c in body["items"]] == sorted(c["name"] for c in body["items"])
    sun = next(c for c in body["items"] if c["customer_code"] == "SUN-001")
    assert sun["account_owner"]["name"] == "Rohan Kulkarni" and sun["tier"] == "enterprise"
    assert set(sun["summary"]) == {"order_count", "lifetime_value", "last_order_at", "unresolved_issues",
                                   "open_issues_only", "investigating_issues", "total_issues", "avg_rating",
                                   "negative_interactions", "last_interaction_at"}

    def codes(**params):
        return [c["customer_code"] for c in client.get("/api/customers", params=params).json()["items"]]

    assert codes(name="green") == ["GRN-002"]
    assert codes(tier="enterprise") == ["SUN-001"]
    assert codes(status="at_risk") == ["SUN-001"]
    assert codes(status="churned") == []
    assert codes(region="west") == ["GRN-002"]
    assert codes(account_owner="rohan") == ["GRN-002", "SUN-001"]
    assert codes(account_owner="meera") == []
    assert codes(name="%") == [] and codes(name="' OR 1=1 --") == []
    assert codes(tier="enterprise", status="active") == []
    assert codes(sort="-lifetime_value") == ["SUN-001", "GRN-002"]
    assert codes(sort="lifetime_value") == ["GRN-002", "SUN-001"]
    assert codes(sort="-unresolved_issues") == ["GRN-002", "SUN-001"]  # Greenfield has 3 unresolved, Sundaram 2
    assert codes(sort="avg_rating") == ["GRN-002", "SUN-001"]
    assert codes(page_size=1, page=2) == ["SUN-001"]
    for params in ({"sort": "tier"}, {"tier": "huge"}, {"status": "lost"}, {"page_size": 101}):
        assert client.get("/api/customers", params=params).status_code == 422, params


def test_summary_numbers_match_other_endpoints(client, db_path):
    login_as(client, OPS)
    for customer in client.get("/api/customers").json()["items"]:
        summary, customer_id = customer["summary"], customer["id"]
        orders = client.get(f"/api/customers/{customer_id}/orders", params={"page_size": 100}).json()
        assert summary["order_count"] == orders["total"] == len(orders["items"])
        assert summary["lifetime_value"] == pytest.approx(
            sum(o["total"] for o in orders["items"] if o["order_status"] != "cancelled"))
        assert summary["last_order_at"] == max(o["created_at"] for o in orders["items"])

        issues = client.get("/api/issues", params={"customer": customer["name"], "page_size": 100}).json()
        assert issues["status_filter"] == "unresolved" and summary["unresolved_issues"] == issues["total"]
        all_issues = client.get("/api/issues", params={"customer": customer["name"], "status": "all"}).json()
        assert summary["total_issues"] == all_issues["total"]
        assert summary["open_issues_only"] == client.get(
            "/api/issues", params={"customer": customer["name"], "status": "open"}).json()["total"]
        assert summary["investigating_issues"] == client.get(
            "/api/issues", params={"customer": customer["name"], "status": "investigating"}).json()["total"]
        negative = client.get(f"/api/customers/{customer_id}/interactions", params={"sentiment": "negative"}).json()
        assert summary["negative_interactions"] == negative["total"]

    # The customer's own view of their issues agrees with ops' summary.
    sundaram_unresolved = next(c for c in client.get("/api/customers").json()["items"]
                               if c["customer_code"] == "SUN-001")["summary"]["unresolved_issues"]
    login_as(client, SUNDARAM)
    assert client.get("/api/issues").json()["total"] == sundaram_unresolved


def test_customer_detail_and_orders(client, db_path):
    login_as(client, OPS)
    sun = cid(db_path, "SUN-001")
    detail = client.get(f"/api/customers/{sun}").json()
    assert (detail["customer_code"], detail["annual_contract_value"], detail["renewal_date"]) == \
        ("SUN-001", 4200000, "2027-01-31")
    assert detail["status"] == "at_risk" and detail["account_owner"]["name"] == "Rohan Kulkarni"
    assert len(detail["contacts"]) == 3 and all(c["email"] and c["phone"] for c in detail["contacts"])
    assert detail["contacts"][0]["is_primary"] is True and detail["contacts"][0]["full_name"] == "Karthik Sundaram"
    assert len(detail["addresses"]) == 2 and detail["addresses"][0]["is_default"] is True
    assert client.get("/api/customers/999999").json() == {"error": "Customer not found"}
    assert client.get("/api/customers/999999").status_code == 404

    orders = client.get(f"/api/customers/{sun}/orders", params={"page_size": 100}).json()
    assert orders["total"] == 14 and {o["customer"]["id"] for o in orders["items"]} == {sun}
    filtered = client.get(f"/api/customers/{sun}/orders", params={"client_network": "offline_sync", "sort": "total"}).json()
    assert filtered["total"] == 6
    totals = [o["total"] for o in filtered["items"]]
    assert totals == sorted(totals)
    # The customer filter can't widen it to another customer.
    assert client.get(f"/api/customers/{sun}/orders", params={"customer": "Greenfield"}).json()["total"] == 0
    assert client.get(f"/api/customers/{sun}/orders", params={"sort": "name"}).status_code == 422
    assert client.get("/api/customers/999999/orders").status_code == 404


# --- history --------------------------------------------------------------------------

def test_timeline(client, db_path):
    login_as(client, OPS)
    sun = cid(db_path, "SUN-001")
    body = client.get(f"/api/customers/{sun}/timeline", params={"page_size": 200}).json()
    expected = scalar(db_path, "SELECT COUNT(*) FROM customer_timeline WHERE customer_id = ?", (sun,))
    assert body["total"] == len(body["items"]) == expected
    types = {e["event_type"] for e in body["items"]}
    assert {"order", "issue", "message", "feedback", "call", "email", "meeting", "escalation", "renewal"} <= types
    stamps = [e["event_at"] for e in body["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert body["page_size"] == 200

    only = client.get(f"/api/customers/{sun}/timeline", params={"event_types": "renewal,escalation"}).json()
    assert {e["event_type"] for e in only["items"]} == {"renewal", "escalation"} and only["total"] == 2
    last_week = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    recent = client.get(f"/api/customers/{sun}/timeline", params={"from": last_week, "page_size": 200}).json()
    assert recent["total"] == scalar(db_path, "SELECT COUNT(*) FROM customer_timeline WHERE customer_id = ? "
                                              "AND date(event_at) >= ?", (sun, last_week))
    assert 0 < recent["total"] < body["total"]
    assert all(e["event_at"] >= last_week for e in recent["items"])
    page2 = client.get(f"/api/customers/{sun}/timeline", params={"page": 2, "page_size": 10}).json()
    assert [e["event_at"] for e in page2["items"]] == stamps[10:20]

    for params in ({"event_types": "order,lunch"}, {"from": "last week"}, {"page_size": 201},
                   {"from": "2026-10-10", "to": "2026-10-01"}):
        assert client.get(f"/api/customers/{sun}/timeline", params=params).status_code == 422, params
    assert client.get("/api/customers/999999/timeline").status_code == 404


def mcp_call(client, name, **arguments):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                         "params": {"name": name, "arguments": arguments}},
                           headers={"Authorization": f"Bearer {os.environ['MCP_API_KEY']}",
                                    "Accept": "application/json, text/event-stream"})
    result = response.json()["result"]
    assert not result.get("isError"), result
    return json.loads(result["content"][0]["text"])


def test_interactions(client, db_path):
    login_as(client, OPS)
    sun, grn = cid(db_path, "SUN-001"), cid(db_path, "GRN-002")
    listing = client.get(f"/api/customers/{sun}/interactions").json()
    assert listing["total"] == 10
    stamps = [x["created_at"] for x in listing["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert {x["created_by_name"] for x in listing["items"]} <= {"Rohan Kulkarni", "Meera Iyer"}
    assert client.get(f"/api/customers/{sun}/interactions", params={"interaction_type": "escalation"}).json()["total"] == 1
    assert client.get(f"/api/customers/{sun}/interactions", params={"sentiment": "negative"}).json()["total"] == 5

    own_order = scalar(db_path, "SELECT MAX(id) FROM orders WHERE customer_id = ?", (sun,))
    response = client.post(f"/api/customers/{sun}/interactions", json={
        "interaction_type": "call", "sentiment": "positive", "order_id": own_order,
        "summary": "  Walked Karthik through the fix plan for duplicate orders; he agreed to a pilot.  "})
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["summary"] == "Walked Karthik through the fix plan for duplicate orders; he agreed to a pilot."
    assert (created["created_by_name"], created["order_id"], created["sentiment"]) == ("Meera Iyer", own_order, "positive")

    default = client.post(f"/api/customers/{grn}/interactions", json={"interaction_type": "note",
                                                                      "summary": "Asked about SMS alerts again."})
    assert default.status_code == 201 and default.json()["sentiment"] == "neutral"

    timeline = client.get(f"/api/customers/{sun}/timeline", params={"event_types": "call", "page_size": 1}).json()
    assert timeline["items"][0]["summary"] == created["summary"]
    mcp = mcp_call(client, "list_interactions", customer="SUN-001", interaction_type="call")
    assert mcp["interactions"][0]["summary"] == created["summary"]
    assert mcp["interactions"][0]["created_by"] == "Meera Iyer"

    other_order = scalar(db_path, "SELECT MIN(id) FROM orders WHERE customer_id = ?", (grn,))
    bad = [({"interaction_type": "lunch", "summary": "valid summary"}, "interaction_type"),
           ({"interaction_type": "call", "summary": "valid summary", "sentiment": "angry"}, "sentiment"),
           ({"interaction_type": "call", "summary": "hey"}, "5 to 2000"),
           ({"interaction_type": "call", "summary": "x" * 2001}, "5 to 2000"),
           ({"interaction_type": "call", "summary": "valid summary", "order_id": other_order}, "not an order of this customer"),
           ({"interaction_type": "call", "summary": "valid summary", "order_id": 999999}, "not an order of this customer")]
    for body, message in bad:
        response = client.post(f"/api/customers/{sun}/interactions", json=body)
        assert response.status_code == 422 and message in response.json()["error"], (body, response.json())
    assert client.post("/api/customers/999999/interactions",
                       json={"interaction_type": "call", "summary": "valid summary"}).status_code == 404
    assert scalar(db_path, "SELECT COUNT(*) FROM customer_interactions") == 22


# --- insights -------------------------------------------------------------------------

def test_insights(client, db_path):
    login_as(client, OPS)
    data = client.get("/api/insights").json()

    def grouped(sql):
        return {r[0]: r[1] for r in rows(db_path, sql)}

    assert data["orders_by_status"] == grouped("SELECT order_status, COUNT(*) FROM orders GROUP BY 1")
    assert sum(data["orders_by_status"].values()) == 25
    assert data["orders_by_client_network"] == {"good": 13, "offline_sync": 8, "weak": 4}
    assert data["issues_by_status"] == grouped("SELECT status, COUNT(*) FROM issues GROUP BY 1")
    assert data["unresolved_issues_by_category"] == grouped(
        "SELECT category, COUNT(*) FROM issues WHERE status IN ('open', 'investigating') GROUP BY 1")
    assert data["unresolved_issues_by_severity"] == grouped(
        "SELECT severity, COUNT(*) FROM issues WHERE status IN ('open', 'investigating') GROUP BY 1")

    feedback = data["feedback"]
    assert feedback["count"] == 13
    assert feedback["average_rating"] == scalar(db_path, "SELECT ROUND(AVG(rating), 2) FROM order_feedback")
    assert feedback["ratings_distribution"] == {"1": 2, "2": 2, "3": 3, "4": 2, "5": 4}

    recurring = {g["category"]: g for g in data["recurring_issues_by_category"]}
    assert {k: v["issue_count"] for k, v in recurring.items()} == {"duplicate_order": 4, "wrong_item": 3, "delay": 3}
    for group in recurring.values():
        assert group["unresolved"] + group["resolved"] == group["issue_count"]
    assert recurring["duplicate_order"]["customers_affected"] == ["Greenfield Seeds Co-op", "Sundaram Agro Distributors"]
    assert recurring["delay"]["customers_affected"] == ["Greenfield Seeds Co-op"]

    top = data["top_customers_by_unresolved_issues"]
    assert [t["name"] for t in top] == ["Greenfield Seeds Co-op", "Sundaram Agro Distributors"]
    assert top[0]["unresolved_issues"] == 3

    recent = data["recent_events"]
    assert len(recent) == 10
    stamps = [e["event_at"] for e in recent]
    assert stamps == sorted(stamps, reverse=True)
    newest = scalar(db_path, "SELECT MAX(event_at) FROM customer_timeline")
    assert stamps[0] == newest.replace(" ", "T") + "Z"

    at_risk = {c["customer_code"]: c for c in data["customers_at_risk"]}
    assert "SUN-001" in at_risk and "GRN-002" not in at_risk
    reasons = at_risk["SUN-001"]["reasons"]
    assert "status is at_risk" in reasons
    assert any("negative interactions in the last 90 days" in r for r in reasons)


def test_negative_interactions_alone_put_a_customer_at_risk(client, db_path):
    login_as(client, OPS)
    grn = cid(db_path, "GRN-002")
    for summary in ("Angry call about the drip kits still missing.", "Escalated the missing drip kits again."):
        client.post(f"/api/customers/{grn}/interactions",
                    json={"interaction_type": "call", "sentiment": "negative", "summary": summary})
    at_risk = {c["customer_code"]: c for c in client.get("/api/insights").json()["customers_at_risk"]}
    assert at_risk["GRN-002"]["reasons"] == ["3 negative interactions in the last 90 days"]
