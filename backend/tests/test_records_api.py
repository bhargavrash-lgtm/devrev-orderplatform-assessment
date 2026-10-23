import json
import os

import pytest
from fastapi.testclient import TestClient

import seed as seed_module
from db import connect, init_db
from main import app
from records_api import MAX_UPLOAD_BYTES

SUNDARAM = "sundaram@orderwave.demo"
GREENFIELD = "greenfield@orderwave.demo"
OPS = "ops@orderwave.demo"
NOT_FOUND = {"error": "Order not found"}

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + bytes(64)
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + bytes(64)
PDF = b"%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"
TXT = "Delivery note: 3 bags torn, photos to follow. Ünïcode ok.\n".encode("utf-8")


@pytest.fixture
def db_path(tmp_path, monkeypatch, ops_password, customer_password):
    path = tmp_path / "records.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))
    monkeypatch.setenv("ORDERWAVE_UPLOADS_DIR", str(tmp_path / "uploads"))
    init_db(path)
    conn = connect(path)
    seed_module.seed(conn, ops_password, customer_password)
    conn.close()
    return path


@pytest.fixture
def uploads(tmp_path):
    return tmp_path / "uploads"


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


def order_of(db_path, code, status=None, without_feedback=False):
    sql = ("SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.customer_code = ?"
           + (" AND o.order_status = ?" if status else "")
           + (" AND NOT EXISTS (SELECT 1 FROM order_feedback f WHERE f.order_id = o.id)" if without_feedback else "")
           + " ORDER BY o.id LIMIT 1")
    return scalar(db_path, sql, (code, status) if status else (code,))


def upload(client, order_id, name, data, content_type="application/octet-stream", issue_id=None):
    return client.post(f"/api/orders/{order_id}/attachments", files={"file": (name, data, content_type)},
                       data={} if issue_id is None else {"issue_id": str(issue_id)})


def delivered_order(client, db_path, sku="FT-UREA-45"):
    """A fresh Sundaram order, placed by the customer and moved to delivered by ops. Leaves ops logged in."""
    login_as(client, SUNDARAM)
    product_id = scalar(db_path, "SELECT id FROM products WHERE sku = ?", (sku,))
    order = client.post("/api/orders", json={"items": [{"product_id": product_id, "quantity": 2}]}).json()
    login_as(client, OPS)
    for step in ("confirmed", "packed", "shipped", "delivered"):
        assert client.put(f"/api/orders/{order['id']}", json={"order_status": step}).status_code == 200
    return order["id"], product_id


# --- authentication -------------------------------------------------------------------

def test_every_route_needs_a_session(client):
    calls = [("GET", "/api/orders/1/messages", {}), ("POST", "/api/orders/1/messages", {"json": {"body": "hi"}}),
             ("GET", "/api/orders/1/issues", {}),
             ("POST", "/api/orders/1/issues", {"json": {"category": "other", "description": "hello there"}}),
             ("GET", "/api/issues", {}), ("PUT", "/api/issues/1", {"json": {"status": "resolved"}}),
             ("GET", "/api/orders/1/feedback", {}), ("POST", "/api/orders/1/feedback", {"json": {"rating": 5}}),
             ("GET", "/api/products/1/reviews", {}),
             ("POST", "/api/products/1/reviews", {"json": {"order_id": 1, "rating": 5}}),
             ("GET", "/api/orders/1/attachments", {}),
             ("POST", "/api/orders/1/attachments", {"files": {"file": ("a.txt", b"hello", "text/plain")}}),
             ("GET", "/api/attachments/1", {})]
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"error": "Not authenticated"}


# --- scoping --------------------------------------------------------------------------

def test_customer_cannot_reach_another_customers_records(client, db_path):
    login_as(client, OPS)
    green = order_of(db_path, "GRN-002", "delivered", without_feedback=False)
    attachment = upload(client, green, "note.txt", TXT).json()
    issue = client.post(f"/api/orders/{green}/issues", json={"category": "other", "description": "ops note"}).json()

    login_as(client, SUNDARAM)
    for order_id in (green, 999999):
        calls = [client.get(f"/api/orders/{order_id}/messages"),
                 client.post(f"/api/orders/{order_id}/messages", json={"body": "hello"}),
                 client.get(f"/api/orders/{order_id}/issues"),
                 client.post(f"/api/orders/{order_id}/issues", json={"category": "other", "description": "sneaky"}),
                 client.get(f"/api/orders/{order_id}/feedback"),
                 client.post(f"/api/orders/{order_id}/feedback", json={"rating": 1}),
                 client.get(f"/api/orders/{order_id}/attachments"),
                 upload(client, order_id, "x.txt", TXT)]
        for response in calls:
            assert response.status_code == 404 and response.json() == NOT_FOUND, response.request.url
    assert client.get(f"/api/attachments/{attachment['id']}").json() == client.get("/api/attachments/999999").json()
    assert client.get(f"/api/attachments/{attachment['id']}").status_code == 404
    assert client.get("/api/issues", params={"order_id": green, "status": "all"}).json()["total"] == 0
    assert client.put(f"/api/issues/{issue['id']}", json={"status": "resolved"}).status_code == 403
    # Nothing was written by the attempts above.
    assert scalar(db_path, "SELECT COUNT(*) FROM order_messages WHERE body = 'hello'") == 0
    assert scalar(db_path, "SELECT COUNT(*) FROM issues WHERE description = 'sneaky'") == 0

    login_as(client, OPS)
    assert client.get(f"/api/orders/{green}/messages").status_code == 200
    assert client.post(f"/api/orders/{green}/messages", json={"body": "ops can"}).status_code == 201
    assert client.get(f"/api/orders/{green}/issues").json()["items"]
    assert client.get(f"/api/orders/{green}/attachments").json()["items"][0]["id"] == attachment["id"]
    assert client.get(f"/api/attachments/{attachment['id']}").status_code == 200
    assert client.get("/api/issues", params={"order_id": green, "status": "all"}).json()["total"] >= 1


# --- messages -------------------------------------------------------------------------

def test_messages(client, db_path):
    login_as(client, SUNDARAM)
    order_id = order_of(db_path, "SUN-001", "confirmed")
    script = "<script>alert('x')</script> & <b>bold</b>"
    posted = []
    for body in ("First question", script, "Third, with   spaces inside"):
        response = client.post(f"/api/orders/{order_id}/messages", json={"body": f"  {body}  "})
        assert response.status_code == 201, response.text
        posted.append(response.json())
    assert posted[1]["body"] == script
    assert posted[0]["author_name"] == "Karthik Sundaram" and posted[0]["author_role"] == "customer"
    assert scalar(db_path, "SELECT body FROM order_messages WHERE id = ?", (posted[1]["id"],)) == script

    login_as(client, OPS)
    reply = client.post(f"/api/orders/{order_id}/messages", json={"body": "Ops reply"}).json()
    assert reply["author_role"] == "ops" and reply["author_name"] == "Meera Iyer"

    listing = client.get(f"/api/orders/{order_id}/messages").json()
    ids = [m["id"] for m in listing["items"]]
    assert ids[-4:] == [p["id"] for p in posted] + [reply["id"]]
    stamps = [m["created_at"] for m in listing["items"]]
    assert stamps == sorted(stamps) and listing["page_size"] == 50
    page = client.get(f"/api/orders/{order_id}/messages", params={"page": 2, "page_size": 2}).json()
    assert page["total"] == listing["total"] and [m["id"] for m in page["items"]] == ids[2:4]

    for bad in ("", "    ", "x" * 2001):
        response = client.post(f"/api/orders/{order_id}/messages", json={"body": bad})
        assert response.status_code == 422 and "1 to 2000 characters" in response.json()["error"]
    assert client.post(f"/api/orders/{order_id}/messages", json={"body": "x" * 2000}).status_code == 201
    assert client.get(f"/api/orders/{order_id}/messages", params={"page_size": 101}).status_code == 422


# --- issues ---------------------------------------------------------------------------

def test_report_issues(client, db_path):
    login_as(client, SUNDARAM)
    order_id = order_of(db_path, "SUN-001", "delivered")
    response = client.post(f"/api/orders/{order_id}/issues",
                           json={"category": "damaged", "description": "  Two bags split open on arrival.  "})
    assert response.status_code == 201, response.text
    issue = response.json()
    assert (issue["status"], issue["severity"], issue["category"]) == ("open", "medium", "damaged")
    assert issue["description"] == "Two bags split open on arrival."
    assert issue["reported_by_name"] == "Karthik Sundaram" and issue["jira_key"] is None
    assert issue["customer"]["name"] == "Sundaram Agro Distributors" and issue["products"]

    jira = client.post(f"/api/orders/{order_id}/issues",
                       json={"category": "other", "description": "Please link this", "jira_key": "SCRUM-77"})
    assert jira.status_code == 403 and "Only ops can set jira_key" in jira.json()["error"]
    for body in ({"category": "lost", "description": "valid text"},
                 {"category": "delay", "severity": "urgent", "description": "valid text"},
                 {"category": "delay", "description": "shrt"},
                 {"category": "delay", "description": "x" * 2001}):
        assert client.post(f"/api/orders/{order_id}/issues", json=body).status_code == 422, body

    login_as(client, OPS)
    ops_issue = client.post(f"/api/orders/{order_id}/issues",
                            json={"category": "billing", "severity": "high", "description": "Invoice mismatch",
                                  "jira_key": "SCRUM-77"})
    assert ops_issue.status_code == 201 and ops_issue.json()["jira_key"] == "SCRUM-77"
    assert client.post(f"/api/orders/{order_id}/issues", json={"category": "billing", "description": "Bad key here",
                                                                "jira_key": "scrum-1"}).status_code == 422
    on_order = client.get(f"/api/orders/{order_id}/issues").json()["items"]
    assert {i["id"] for i in on_order} >= {issue["id"], ops_issue.json()["id"]}


def test_update_issue(client, db_path):
    login_as(client, OPS)
    issue_id = scalar(db_path, "SELECT id FROM issues WHERE status = 'open' ORDER BY id LIMIT 1")
    response = client.put(f"/api/issues/{issue_id}", json={"status": "investigating", "severity": "high",
                                                           "category": "billing", "jira_key": "OPS-123"})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert (updated["status"], updated["severity"], updated["category"], updated["jira_key"]) == \
        ("investigating", "high", "billing", "OPS-123")
    assert client.put(f"/api/issues/{issue_id}", json={"status": "resolved"}).json()["jira_key"] == "OPS-123"
    assert client.put(f"/api/issues/{issue_id}", json={"jira_key": None}).json()["jira_key"] is None

    for body in ({"jira_key": "ops-123"}, {"jira_key": "SCRUM24"}, {"jira_key": "SCRUM-24; DROP"},
                 {"status": "closed"}, {"severity": "urgent"}, {"status": None}, {}):
        assert client.put(f"/api/issues/{issue_id}", json=body).status_code == 422, body
    assert client.put("/api/issues/999999", json={"status": "resolved"}).status_code == 404

    login_as(client, SUNDARAM)
    forbidden = client.put(f"/api/issues/{issue_id}", json={"status": "open"})
    assert forbidden.status_code == 403
    assert scalar(db_path, "SELECT status FROM issues WHERE id = ?", (issue_id,)) == "resolved"


def test_issue_list_filters(client, db_path):
    login_as(client, OPS)

    def ids(**params):
        body = client.get("/api/issues", params={"page_size": 100, **params}).json()
        assert body["total"] == len(body["items"])
        return sorted(i["id"] for i in body["items"])

    def sql_ids(where="1=1", params=()):
        return sorted(r[0] for r in rows(db_path, "SELECT i.id FROM issues i JOIN orders o ON o.id = i.order_id "
                                                  f"JOIN customers c ON c.id = o.customer_id WHERE {where}", params))

    default = client.get("/api/issues", params={"page_size": 100}).json()
    assert default["status_filter"] == "unresolved"
    assert sorted(i["id"] for i in default["items"]) == sql_ids("i.status IN ('open', 'investigating')")
    assert ids(status="all") == sql_ids() and len(sql_ids()) == 12
    assert ids(status="open") == sql_ids("i.status = 'open'")
    assert ids(status="resolved") == sql_ids("i.status = 'resolved'")
    assert ids(status="all", category="duplicate_order") == sql_ids("i.category = 'duplicate_order'")
    assert len(ids(status="all", category="duplicate_order")) == 4
    assert ids(status="all", severity="high") == sql_ids("i.severity = 'high'")
    assert ids(status="all", customer="Greenfield") == sql_ids("c.name LIKE '%Greenfield%'")
    assert ids(status="all", jira_key="scrum-25") == sql_ids("i.jira_key = 'SCRUM-25'")
    order_id = scalar(db_path, "SELECT order_id FROM issues WHERE jira_key = 'SCRUM-24'")
    assert ids(status="all", order_id=order_id) == sql_ids("i.order_id = ?", (order_id,))
    assert ids(status="all", customer="Sundaram", category="duplicate_order", severity="high") == \
        sql_ids("c.name LIKE '%Sundaram%' AND i.category = 'duplicate_order' AND i.severity = 'high'")
    assert ids(status="all", customer="' OR 1=1 --") == [] and ids(status="all", customer="%") == []

    item = client.get("/api/issues", params={"jira_key": "SCRUM-25", "status": "all"}).json()["items"][0]
    assert item["customer"]["name"] == "Sundaram Agro Distributors" and item["reported_by_name"] == "Karthik Sundaram"
    assert [p["sku"] for p in item["products"]] == ["SD-PDY-1121", "FT-ZN-5", "CP-MNZ-1"]

    rank = {"low": 1, "medium": 2, "high": 3}
    severities = [rank[i["severity"]] for i in
                  client.get("/api/issues", params={"status": "all", "sort": "-severity", "page_size": 100}).json()["items"]]
    assert severities == sorted(severities, reverse=True)
    stamps = [i["created_at"] for i in client.get("/api/issues", params={"status": "all", "sort": "created_at"}).json()["items"]]
    assert stamps == sorted(stamps)
    page = client.get("/api/issues", params={"status": "all", "page": 2, "page_size": 5}).json()
    assert page["total"] == 12 and len(page["items"]) == 5
    for params in ({"sort": "description"}, {"status": "closed"}, {"category": "lost"}, {"page_size": 101}):
        assert client.get("/api/issues", params=params).status_code == 422, params

    login_as(client, SUNDARAM)
    mine = client.get("/api/issues", params={"status": "all", "page_size": 100}).json()["items"]
    assert {i["customer"]["name"] for i in mine} == {"Sundaram Agro Distributors"}
    assert len(mine) == len(sql_ids("c.customer_code = 'SUN-001'"))
    assert ids(status="all", customer="Greenfield") == ids(status="all")  # ignored for customers


# --- feedback -------------------------------------------------------------------------

def test_feedback(client, db_path):
    order_id, _ = delivered_order(client, db_path)
    ops_try = client.post(f"/api/orders/{order_id}/feedback", json={"rating": 5})
    assert ops_try.status_code == 403 and "Only customers" in ops_try.json()["error"]

    login_as(client, SUNDARAM)
    assert client.get(f"/api/orders/{order_id}/feedback").json() == {"error": "Feedback not found"}
    not_delivered = order_of(db_path, "SUN-001", "confirmed")
    early = client.post(f"/api/orders/{not_delivered}/feedback", json={"rating": 4})
    assert early.status_code == 422 and "delivered" in early.json()["error"]
    for rating in (0, 6, -1):
        assert client.post(f"/api/orders/{order_id}/feedback", json={"rating": rating}).status_code == 422
    assert client.post(f"/api/orders/{order_id}/feedback",
                       json={"rating": 4, "comment": "x" * 1001}).status_code == 422

    response = client.post(f"/api/orders/{order_id}/feedback", json={"rating": 4, "comment": "Arrived on time."})
    assert response.status_code == 201
    assert response.json() == {**response.json(), "order_id": order_id, "rating": 4, "comment": "Arrived on time."}
    duplicate = client.post(f"/api/orders/{order_id}/feedback", json={"rating": 1})
    assert duplicate.status_code == 409 and "already" in duplicate.json()["error"]
    assert client.get(f"/api/orders/{order_id}/feedback").json()["rating"] == 4
    assert scalar(db_path, "SELECT COUNT(*) FROM order_feedback WHERE order_id = ?", (order_id,)) == 1


# --- reviews --------------------------------------------------------------------------

def test_reviews(client, db_path):
    order_id, product_id = delivered_order(client, db_path, sku="SD-MZE-HY900")
    other_product = scalar(db_path, "SELECT id FROM products WHERE sku = 'EQ-SCK-W'")
    assert client.post(f"/api/products/{product_id}/reviews",
                       json={"order_id": order_id, "rating": 5}).status_code == 403  # ops

    login_as(client, SUNDARAM)
    green_order = order_of(db_path, "GRN-002", "delivered")
    undelivered = client.post("/api/orders", json={"items": [{"product_id": product_id, "quantity": 1}]}).json()["id"]
    cases = [
        (product_id, {"order_id": green_order, "rating": 5}, "not one of your orders"),
        (product_id, {"order_id": 999999, "rating": 5}, "not one of your orders"),
        (product_id, {"order_id": undelivered, "rating": 5}, "not been delivered"),
        (other_product, {"order_id": order_id, "rating": 5}, "does not contain this product"),
    ]
    for pid, body, message in cases:
        response = client.post(f"/api/products/{pid}/reviews", json=body)
        assert response.status_code == 422 and message in response.json()["error"], (body, response.json())
    for rating in (0, 6):
        assert client.post(f"/api/products/{product_id}/reviews",
                           json={"order_id": order_id, "rating": rating}).status_code == 422
    assert client.post("/api/products/999999/reviews", json={"order_id": order_id, "rating": 5}).status_code == 404

    created = client.post(f"/api/products/{product_id}/reviews",
                          json={"order_id": order_id, "rating": 3, "comment": "Germination around 80%."})
    assert created.status_code == 201
    assert created.json()["customer_name"] == "Sundaram Agro Distributors"
    duplicate = client.post(f"/api/products/{product_id}/reviews", json={"order_id": order_id, "rating": 5})
    assert duplicate.status_code == 409

    login_as(client, GREENFIELD)
    tomato = scalar(db_path, "SELECT id FROM products WHERE sku = 'SD-TOM-AR01'")
    listing = client.get(f"/api/products/{tomato}/reviews").json()
    count, average = rows(db_path, "SELECT COUNT(*), ROUND(AVG(rating), 2) FROM product_reviews WHERE product_id = ?",
                          (tomato,))[0]
    assert (listing["review_count"], listing["average_rating"]) == (count, average) == (3, round(5 / 3, 2))
    assert listing["total"] == 3 and all(set(r) >= {"customer_name", "rating", "comment", "created_at"}
                                         for r in listing["items"])
    maize = client.get(f"/api/products/{product_id}/reviews").json()
    assert (maize["review_count"], maize["average_rating"]) == (1, 3.0)
    assert client.get("/api/products/999999/reviews").status_code == 404


# --- attachments ----------------------------------------------------------------------

def test_attachment_types(client, db_path, uploads):
    login_as(client, SUNDARAM)
    order_id = order_of(db_path, "SUN-001", "delivered")
    accepted = {"photo.png": (PNG, "image/png"), "scan.JPG": (JPG, "image/jpeg"), "photo.jpeg": (JPG, "image/jpeg"),
                "invoice.pdf": (PDF, "application/pdf"), "notes.txt": (TXT, "text/plain; charset=utf-8")}
    for name, (data, expected_type) in accepted.items():
        response = upload(client, order_id, name, data)
        assert response.status_code == 201, (name, response.text)
        body = response.json()
        assert body["content_type"] == expected_type and body["size_bytes"] == len(data) and body["filename"] == name

    rejected = {
        "setup.exe as png": ("setup.png", b"MZ\x90\x00\x03\x00\x00\x00" + bytes(64), "image/png"),
        "html as png": ("page.png", b"<html><script>alert(1)</script></html>", "image/png"),
        "png named exe": ("photo.exe", PNG, "image/png"),
        "png named txt": ("photo.txt", PNG, "text/plain"),
        "pdf named png": ("doc.png", PDF, "image/png"),
        "binary as txt": ("data.txt", b"\xff\xfe\x00\x01bad utf-8 \x80", "text/plain"),
        "nul bytes as txt": ("data.txt", b"abc\x00def", "text/plain"),
        "no extension": ("README", TXT, "text/plain"),
        "empty": ("empty.txt", b"", "text/plain"),
    }
    for label, (name, data, content_type) in rejected.items():
        response = upload(client, order_id, name, data, content_type)
        assert response.status_code == 422, (label, response.text)
    assert len(list(uploads.iterdir())) == len(accepted)  # nothing extra on disk


def test_attachment_size_limit(client, db_path, uploads):
    login_as(client, SUNDARAM)
    order_id = order_of(db_path, "SUN-001", "delivered")
    just_over = upload(client, order_id, "big.png", PNG + bytes(MAX_UPLOAD_BYTES))
    assert just_over.status_code == 413 and "5 MB" in just_over.json()["error"]
    way_over = upload(client, order_id, "huge.png", PNG + bytes(MAX_UPLOAD_BYTES + 200_000))
    assert way_over.status_code == 413
    exact = upload(client, order_id, "max.png", PNG + bytes(MAX_UPLOAD_BYTES - len(PNG)))
    assert exact.status_code == 201
    assert [p.stat().st_size for p in uploads.iterdir()] == [MAX_UPLOAD_BYTES]


def test_attachment_storage_and_download(client, db_path, uploads):
    login_as(client, SUNDARAM)
    order_id = order_of(db_path, "SUN-001", "delivered")
    issue_id = client.post(f"/api/orders/{order_id}/issues",
                           json={"category": "damaged", "description": "Photo of torn bag attached"}).json()["id"]
    response = upload(client, order_id, "../../etc/x.png", PNG, issue_id=issue_id)
    assert response.status_code == 201, response.text
    meta = response.json()
    assert meta["filename"] == "x.png" and meta["issue_id"] == issue_id
    assert meta["uploaded_by_name"] == "Karthik Sundaram"

    stored = scalar(db_path, "SELECT storage_path FROM attachments WHERE id = ?", (meta["id"],))
    on_disk = [p.name for p in uploads.iterdir()]
    assert on_disk == [stored] and "x" not in stored.removesuffix(".png")
    assert len(stored) == 32 + len(".png") and "/" not in stored and "\\" not in stored
    assert (uploads / stored).read_bytes() == PNG

    weird = upload(client, order_id, 'a<b>:"c|?*.txt', TXT).json()
    assert all(ch not in weird["filename"] for ch in '<>:"|?*/\\')

    other_issue = scalar(db_path, "SELECT id FROM issues WHERE order_id != ? ORDER BY id LIMIT 1", (order_id,))
    assert upload(client, order_id, "y.png", PNG, issue_id=other_issue).status_code == 422

    listing = client.get(f"/api/orders/{order_id}/attachments").json()["items"]
    assert [a["id"] for a in listing] == [meta["id"], weird["id"]]
    assert set(listing[0]) == {"id", "order_id", "issue_id", "filename", "content_type", "size_bytes",
                               "uploaded_by_name", "created_at"}

    download = client.get(f"/api/attachments/{meta['id']}")
    assert download.status_code == 200 and download.content == PNG
    assert download.headers["content-type"] == "image/png"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert 'filename="x.png"' in download.headers["content-disposition"]

    login_as(client, OPS)
    assert client.get(f"/api/attachments/{meta['id']}").status_code == 200
    login_as(client, GREENFIELD)
    denied = client.get(f"/api/attachments/{meta['id']}")
    assert denied.status_code == 404 and denied.json() == client.get("/api/attachments/999999").json()
    assert client.get("/uploads/" + stored).status_code == 404  # never served as a static folder


# --- MCP sees the new records ---------------------------------------------------------

def mcp_call(client, name, **arguments):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                         "params": {"name": name, "arguments": arguments}},
                           headers={"Authorization": f"Bearer {os.environ['MCP_API_KEY']}",
                                    "Accept": "application/json, text/event-stream"})
    result = response.json()["result"]
    assert not result.get("isError"), result
    return json.loads(result["content"][0]["text"])


def test_mcp_sees_new_records(client, db_path):
    order_id, _ = delivered_order(client, db_path)
    login_as(client, SUNDARAM)
    client.post(f"/api/orders/{order_id}/messages", json={"body": "Thanks, all received in good shape."})
    issue = client.post(f"/api/orders/{order_id}/issues",
                        json={"category": "billing", "severity": "low", "description": "Invoice shows the old price."}).json()
    client.post(f"/api/orders/{order_id}/feedback", json={"rating": 5, "comment": "Smooth order."})

    order = mcp_call(client, "get_order", order_id=order_id)
    assert order["messages"][-1]["body"] == "Thanks, all received in good shape."
    assert order["issues"][-1]["description"] == "Invoice shows the old price."
    assert order["feedback"] == {**order["feedback"], "rating": 5, "comment": "Smooth order."}
    listed = mcp_call(client, "list_issues", status="open", category="billing")
    assert issue["id"] in [i["issue_id"] for i in listed["issues"]]
    assert any(m["body"] == "Thanks, all received in good shape." for m in
               mcp_call(client, "list_messages", order_id=order_id)["messages"])
    assert any(f["comment"] == "Smooth order." for f in mcp_call(client, "list_feedback", min_rating=5)["feedback"])
