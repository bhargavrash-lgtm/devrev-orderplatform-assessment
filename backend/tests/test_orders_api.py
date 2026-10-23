import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

import db
import orders_api
import seed as seed_module
from db import connect, init_db
from main import app

SUNDARAM = "sundaram@orderwave.demo"
GREENFIELD = "greenfield@orderwave.demo"
OPS = "ops@orderwave.demo"
NOT_FOUND = {"error": "Order not found"}


@pytest.fixture
def db_path(tmp_path, monkeypatch, ops_password, customer_password):
    path = tmp_path / "orders.db"
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(path))
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
    password = os.environ["SEED_OPS_PASSWORD" if email.endswith(("ops@orderwave.demo", "accounts@orderwave.demo"))
                          else "SEED_CUSTOMER_PASSWORD"]
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def q(db_path, sql, params=()):
    conn = connect(db_path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def scalar(db_path, sql, params=()):
    return q(db_path, sql, params)[0][0]


def customer_id(db_path, code):
    return scalar(db_path, "SELECT id FROM customers WHERE customer_code = ?", (code,))


def product(db_path, sku):
    return q(db_path, "SELECT id, unit_price, stock FROM products WHERE sku = ?", (sku,))[0]


def stock(db_path, product_id):
    return scalar(db_path, "SELECT stock FROM products WHERE id = ?", (product_id,))


def list_ids(client, **params):
    response = client.get("/api/orders", params={"page_size": 100, **params})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == len(body["items"])
    return [o["id"] for o in body["items"]]


def ids_sql(db_path, where="1=1", params=()):
    return sorted(r[0] for r in q(db_path, f"SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id "
                                           f"WHERE {where}", params))


def new_order(client, items, **extra):
    return client.post("/api/orders", json={"items": items, **extra}, headers=extra.pop("headers", None) or {})


# --- authentication -------------------------------------------------------------------

def test_every_route_needs_a_session(client):
    for method, path, body in [("GET", "/api/products", None), ("GET", "/api/orders", None),
                               ("GET", "/api/orders/1", None),
                               ("POST", "/api/orders", {"items": [{"product_id": 1, "quantity": 1}]}),
                               ("PUT", "/api/orders/1", {"order_status": "confirmed"})]:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"error": "Not authenticated"}


# --- products -------------------------------------------------------------------------

def test_products_list_filters_and_sort(client, db_path):
    login_as(client, SUNDARAM)
    body = client.get("/api/products").json()
    assert body["total"] == 20 and body["page"] == 1 and body["page_size"] == 20
    assert set(body["items"][0]) == {"id", "sku", "name", "category", "description", "unit_price", "stock", "image_url"}
    names = [p["name"] for p in body["items"]]
    assert names == sorted(names)

    assert [p["sku"] for p in client.get("/api/products", params={"q": "sd-tom"}).json()["items"]] == ["SD-TOM-AR01"]
    assert client.get("/api/products", params={"q": "tomato"}).json()["total"] == 1
    seeds = client.get("/api/products", params={"category": "seeds"}).json()
    assert seeds["total"] == 5 and all(p["category"] == "Seeds" for p in seeds["items"])
    prices = [p["unit_price"] for p in client.get("/api/products", params={"sort": "-unit_price"}).json()["items"]]
    assert prices == sorted(prices, reverse=True)
    stocks = [p["stock"] for p in client.get("/api/products", params={"sort": "stock", "page_size": 100}).json()["items"]]
    assert stocks == sorted(stocks)

    pid = product(db_path, "EQ-SCK-W")["id"]
    conn = connect(db_path)
    conn.execute("UPDATE products SET stock = 0 WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    assert client.get("/api/products", params={"in_stock": "true"}).json()["total"] == 19
    assert [p["id"] for p in client.get("/api/products", params={"in_stock": "false"}).json()["items"]] == [pid]

    page2 = client.get("/api/products", params={"page": 2, "page_size": 15}).json()
    assert page2["total"] == 20 and len(page2["items"]) == 5
    assert client.get("/api/products", params={"sort": "price"}).status_code == 422
    assert client.get("/api/products", params={"page_size": 101}).status_code == 422
    # % and _ are literal: '%' only matches names that really contain a percent sign.
    percent = client.get("/api/products", params={"q": "%", "page_size": 100}).json()
    assert percent["total"] == scalar(db_path, "SELECT COUNT(*) FROM products WHERE instr(name, '%') > 0") < 20
    assert client.get("/api/products", params={"q": "_"}).json()["total"] == 0
    assert client.get("/api/products", params={"q": "' OR 1=1 --"}).json()["total"] == 0


# --- scoping --------------------------------------------------------------------------

def test_customer_sees_only_own_orders(client, db_path):
    sun, grn = customer_id(db_path, "SUN-001"), customer_id(db_path, "GRN-002")
    login_as(client, SUNDARAM)
    body = client.get("/api/orders", params={"page_size": 100}).json()
    assert body["total"] == scalar(db_path, "SELECT COUNT(*) FROM orders WHERE customer_id = ?", (sun,)) == 14
    assert {o["customer"]["name"] for o in body["items"]} == {"Sundaram Agro Distributors"}

    # Asking for the other customer explicitly changes nothing.
    assert list_ids(client, customer="Greenfield") == list_ids(client)

    greenfield_order = scalar(db_path, "SELECT MIN(id) FROM orders WHERE customer_id = ?", (grn,))
    other = client.get(f"/api/orders/{greenfield_order}")
    missing = client.get("/api/orders/999999")
    assert other.status_code == missing.status_code == 404
    assert other.json() == missing.json() == NOT_FOUND
    assert other.headers.get("content-length") == missing.headers.get("content-length")
    assert list_ids(client, id=greenfield_order) == []

    own = scalar(db_path, "SELECT MIN(id) FROM orders WHERE customer_id = ?", (sun,))
    assert client.get(f"/api/orders/{own}").status_code == 200


def test_ops_sees_all_orders(client, db_path):
    login_as(client, OPS)
    assert sorted(list_ids(client)) == ids_sql(db_path)
    assert sorted(list_ids(client, customer="Greenfield")) == ids_sql(db_path, "c.name LIKE '%Greenfield%'")
    assert len(list_ids(client, customer="Greenfield")) == 11


# --- list filters ---------------------------------------------------------------------

def test_order_filters_alone_and_combined(client, db_path):
    login_as(client, OPS)
    one = ids_sql(db_path)[5]
    assert list_ids(client, id=one) == [one]

    tomato = ids_sql(db_path, "EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id "
                              "WHERE oi.order_id = o.id AND p.sku = 'SD-TOM-AR01')")
    assert sorted(list_ids(client, product="SD-TOM-AR01")) == tomato
    assert sorted(list_ids(client, product="arka rakshak")) == tomato
    assert len(tomato) >= 3

    assert sorted(list_ids(client, status="delivered")) == ids_sql(db_path, "o.order_status = 'delivered'")
    assert sorted(list_ids(client, status="placed,confirmed, packed")) == \
        ids_sql(db_path, "o.order_status IN ('placed', 'confirmed', 'packed')")
    assert sorted(list_ids(client, client_network="offline_sync")) == ids_sql(db_path, "o.client_network = 'offline_sync'")
    assert len(list_ids(client, client_network="offline_sync")) == 8

    first, last = q(db_path, "SELECT date(MIN(created_at)), date(MAX(created_at)) FROM orders")[0]
    assert sorted(list_ids(client, **{"from": first, "to": last})) == ids_sql(db_path)
    mid = q(db_path, "SELECT date(created_at) FROM orders ORDER BY created_at LIMIT 1 OFFSET 12")[0][0]
    assert sorted(list_ids(client, **{"from": mid})) == ids_sql(db_path, "date(o.created_at) >= ?", (mid,))
    assert sorted(list_ids(client, to=mid)) == ids_sql(db_path, "date(o.created_at) <= ?", (mid,))
    assert sorted(list_ids(client, **{"from": mid, "to": mid})) == ids_sql(db_path, "date(o.created_at) = ?", (mid,))

    combined = list_ids(client, customer="Sundaram", client_network="offline_sync", status="delivered,confirmed",
                        **{"from": first})
    assert sorted(combined) == ids_sql(
        db_path, "c.name LIKE '%Sundaram%' AND o.client_network = 'offline_sync' "
                 "AND o.order_status IN ('delivered', 'confirmed') AND date(o.created_at) >= ?", (first,))
    assert len(combined) == 5  # the sixth offline_sync order at Sundaram is cancelled


def test_pagination_and_sorting(client, db_path):
    login_as(client, OPS)
    pages = [client.get("/api/orders", params={"page": n, "page_size": 10}).json() for n in (1, 2, 3, 4)]
    assert all(p["total"] == 25 and p["page_size"] == 10 for p in pages)
    assert [len(p["items"]) for p in pages] == [10, 10, 5, 0]
    seen = [o["id"] for p in pages for o in p["items"]]
    assert sorted(seen) == ids_sql(db_path) and len(set(seen)) == 25

    default = client.get("/api/orders", params={"page_size": 100}).json()["items"]
    stamps = [o["created_at"] for o in default]
    assert stamps == sorted(stamps, reverse=True)
    for sort, key, reverse in [("total", "total", False), ("-total", "total", True), ("id", "id", False),
                               ("-id", "id", True), ("created_at", "created_at", False)]:
        values = [o[key] for o in client.get("/api/orders", params={"sort": sort, "page_size": 100}).json()["items"]]
        assert values == sorted(values, reverse=reverse), sort


def test_invalid_list_parameters(client):
    login_as(client, OPS)
    cases = {
        "sort": {"sort": "customer"},
        "sort injection": {"sort": "total; DROP TABLE orders"},
        "date": {"from": "2026-13-01"},
        "date format": {"to": "01/10/2026"},
        "date order": {"from": "2026-10-10", "to": "2026-10-01"},
        "status": {"status": "placed,lost"},
        "client_network": {"client_network": "satellite"},
        "page_size": {"page_size": 101},
        "page": {"page": 0},
        "id": {"id": "1 OR 1=1"},
    }
    for label, params in cases.items():
        response = client.get("/api/orders", params=params)
        assert response.status_code == 422, label
        assert set(response.json()) == {"error"} and response.json()["error"], label
    assert "YYYY-MM-DD" in client.get("/api/orders", params={"from": "yesterday"}).json()["error"]
    assert "sort must be one of" in client.get("/api/orders", params={"sort": "name"}).json()["error"]


@pytest.mark.parametrize("evil", ["' OR 1=1 --", "%", "_", "\\", "%' OR '1'='1"])
def test_filter_values_are_not_sql(client, db_path, evil):
    login_as(client, OPS)
    assert list_ids(client, customer=evil) == []
    expected_product = ids_sql(
        db_path, "EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id "
                 "WHERE oi.order_id = o.id AND (instr(lower(p.name), lower(?)) > 0 OR instr(lower(p.sku), lower(?)) > 0))",
        (evil, evil))
    assert sorted(list_ids(client, product=evil)) == expected_product
    assert len(expected_product) < 25
    login_as(client, SUNDARAM)
    assert list_ids(client, customer=evil) == list_ids(client)  # ignored for customers, still scoped


def test_list_runs_a_fixed_number_of_queries(client):
    login_as(client, OPS)
    statements: list[list[str]] = []

    def counting_db():
        conn = connect()
        log: list[str] = []
        conn.set_trace_callback(log.append)
        statements.append(log)
        try:
            yield conn
        finally:
            conn.close()

    app.dependency_overrides[db.get_db] = counting_db
    try:
        counts = {}
        for size in (1, 5, 25, 100):
            statements.clear()
            assert client.get("/api/orders", params={"page_size": size}).status_code == 200
            counts[size] = sum(1 for log in statements for s in log if s.lstrip().upper().startswith("SELECT"))
    finally:
        app.dependency_overrides.pop(db.get_db, None)
    assert len(set(counts.values())) == 1, counts
    assert counts[100] <= 4  # session user, count, page, items


# --- order detail ---------------------------------------------------------------------

def test_order_detail(client, db_path):
    login_as(client, OPS)
    order_id = scalar(db_path, "SELECT order_id FROM issues WHERE jira_key = 'SCRUM-24'")
    order = client.get(f"/api/orders/{order_id}").json()
    assert order["customer"]["name"] == "Sundaram Agro Distributors"
    assert order["address"]["label"] == "Hosakote field office"
    assert order["events"][0]["from_status"] is None and order["events"][0]["to_status"] == "placed"
    assert order["events"][0]["changed_by_name"] == "Karthik Sundaram"
    stamps = [e["created_at"] for e in order["events"]]
    assert stamps == sorted(stamps)
    assert order["counts"] == {"messages": 0, "issues": 1, "attachments": 0}
    assert order["has_feedback"] is False
    assert order["item_count"] == len(order["items"]) == 2
    assert "password_hash" not in json.dumps(order)


# --- creating orders ------------------------------------------------------------------

def test_create_order(client, db_path):
    me = login_as(client, SUNDARAM)
    urea, dap = product(db_path, "FT-UREA-45"), product(db_path, "FT-DAP-50")
    before = scalar(db_path, "SELECT COUNT(*) FROM orders")
    response = new_order(client, [{"product_id": urea["id"], "quantity": 10}, {"product_id": dap["id"], "quantity": 3}],
                         delivery_note="Gate 2", client_network="weak")
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["total"] == 10 * urea["unit_price"] + 3 * dap["unit_price"]
    assert {i["product_id"]: i["unit_price"] for i in order["items"]} == {urea["id"]: urea["unit_price"],
                                                                          dap["id"]: dap["unit_price"]}
    assert order["order_status"] == "placed" and order["client_network"] == "weak"
    assert order["customer"]["id"] == me["customer_id"]
    assert order["address"]["label"] == "Bengaluru warehouse"  # the customer's default
    assert order["events"] == [{"from_status": None, "to_status": "placed", "changed_by_name": "Karthik Sundaram",
                                "created_at": order["created_at"]}]
    assert stock(db_path, urea["id"]) == urea["stock"] - 10
    assert stock(db_path, dap["id"]) == dap["stock"] - 3
    assert scalar(db_path, "SELECT COUNT(*) FROM orders") == before + 1
    assert scalar(db_path, "SELECT placed_by FROM orders WHERE id = ?", (order["id"],)) == me["id"]
    stored = q(db_path, "SELECT product_id, unit_price FROM order_items WHERE order_id = ?", (order["id"],))
    assert {r[0]: r[1] for r in stored} == {urea["id"]: urea["unit_price"], dap["id"]: dap["unit_price"]}


def test_create_order_validation_changes_nothing(client, db_path):
    login_as(client, SUNDARAM)
    urea, kit = product(db_path, "FT-UREA-45"), product(db_path, "EQ-DRP-KIT")
    other_address = scalar(db_path, "SELECT id FROM customer_addresses WHERE customer_id = ?",
                           (customer_id(db_path, "GRN-002"),))

    def snapshot():
        return (scalar(db_path, "SELECT COUNT(*) FROM orders"), scalar(db_path, "SELECT COUNT(*) FROM order_items"),
                scalar(db_path, "SELECT COUNT(*) FROM order_events"), scalar(db_path, "SELECT SUM(stock) FROM products"))

    before = snapshot()
    cases = {
        "stock shortage": ({"items": [{"product_id": urea["id"], "quantity": 5},
                                      {"product_id": kit["id"], "quantity": kit["stock"] + 1}]}, "Not enough stock"),
        "unknown product": ({"items": [{"product_id": 99999, "quantity": 1}]}, "Unknown product_id"),
        "quantity 0": ({"items": [{"product_id": urea["id"], "quantity": 0}]}, "quantity"),
        "negative quantity": ({"items": [{"product_id": urea["id"], "quantity": -3}]}, "quantity"),
        "quantity over 1000": ({"items": [{"product_id": urea["id"], "quantity": 1001}]}, "quantity"),
        "no items": ({"items": []}, "items"),
        "duplicate product": ({"items": [{"product_id": urea["id"], "quantity": 1},
                                         {"product_id": urea["id"], "quantity": 2}]}, "only once"),
        "other customer's address": ({"items": [{"product_id": urea["id"], "quantity": 1}],
                                      "address_id": other_address}, "not one of this customer's addresses"),
        "missing address": ({"items": [{"product_id": urea["id"], "quantity": 1}], "address_id": 99999},
                            "not one of this customer's addresses"),
        "bad client_network": ({"items": [{"product_id": urea["id"], "quantity": 1}], "client_network": "5g"},
                               "client_network"),
    }
    for label, (body, message) in cases.items():
        response = client.post("/api/orders", json=body)
        assert response.status_code == 422, (label, response.text)
        assert message in response.json()["error"], (label, response.json())
    assert snapshot() == before
    assert stock(db_path, urea["id"]) == urea["stock"]


def test_ops_creates_for_a_customer(client, db_path):
    me = login_as(client, OPS)
    grn = customer_id(db_path, "GRN-002")
    urea = product(db_path, "FT-UREA-45")
    missing = new_order(client, [{"product_id": urea["id"], "quantity": 1}])
    assert missing.status_code == 422 and "customer_id is required" in missing.json()["error"]
    assert new_order(client, [{"product_id": urea["id"], "quantity": 1}], customer_id=99999).status_code == 422

    response = new_order(client, [{"product_id": urea["id"], "quantity": 2}], customer_id=grn)
    assert response.status_code == 201
    order = response.json()
    assert order["customer"]["id"] == grn and order["address"]["label"] == "Pune godown"
    assert order["events"][0]["changed_by_name"] == "Meera Iyer"
    assert scalar(db_path, "SELECT placed_by FROM orders WHERE id = ?", (order["id"],)) == me["id"]


def test_customer_cannot_create_for_another_customer(client, db_path):
    me = login_as(client, SUNDARAM)
    grn = customer_id(db_path, "GRN-002")
    response = new_order(client, [{"product_id": product(db_path, "FT-UREA-45")["id"], "quantity": 1}], customer_id=grn)
    assert response.status_code == 201
    assert response.json()["customer"]["id"] == me["customer_id"] != grn


# --- idempotency ----------------------------------------------------------------------

def post_with_key(client, key, items):
    return client.post("/api/orders", json={"items": items}, headers={"Idempotency-Key": key})


def test_idempotency_key(client, db_path):
    login_as(client, SUNDARAM)
    urea = product(db_path, "FT-UREA-45")
    items = [{"product_id": urea["id"], "quantity": 7}]
    before = scalar(db_path, "SELECT COUNT(*) FROM orders")

    first = post_with_key(client, "checkout-abc-1", items)
    second = post_with_key(client, "checkout-abc-1", items)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"]
    assert second.json() == first.json()
    assert scalar(db_path, "SELECT COUNT(*) FROM orders") == before + 1
    assert stock(db_path, urea["id"]) == urea["stock"] - 7

    third = post_with_key(client, "checkout-abc-2", items)
    assert third.status_code == 201 and third.json()["id"] != first.json()["id"]
    assert stock(db_path, urea["id"]) == urea["stock"] - 14

    login_as(client, GREENFIELD)
    other_user = post_with_key(client, "checkout-abc-1", items)
    assert other_user.status_code == 201 and other_user.json()["id"] != first.json()["id"]
    assert other_user.json()["customer"]["name"] == "Greenfield Seeds Co-op"
    assert scalar(db_path, "SELECT COUNT(*) FROM orders") == before + 3

    too_long = post_with_key(client, "k" * 101, items)
    assert too_long.status_code == 422 and "Idempotency-Key" in too_long.json()["error"]


def test_idempotency_key_concurrent(client, db_path):
    login_as(client, SUNDARAM)
    dap = product(db_path, "FT-DAP-50")
    items = [{"product_id": dap["id"], "quantity": 4}]
    before = scalar(db_path, "SELECT COUNT(*) FROM orders")
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: post_with_key(client, "same-key-race", items), range(6)))
    codes = sorted(r.status_code for r in responses)
    assert codes == [200] * 5 + [201], [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    assert scalar(db_path, "SELECT COUNT(*) FROM orders") == before + 1
    assert stock(db_path, dap["id"]) == dap["stock"] - 4


def test_unique_index_stops_a_second_order(client, db_path, monkeypatch):
    """Even if both requests miss the existence check, the index stops the second insert."""
    me = login_as(client, SUNDARAM)
    urea = product(db_path, "FT-UREA-45")
    items = [{"product_id": urea["id"], "quantity": 2}]
    real = orders_api._find_by_idempotency_key
    calls = {"n": 0}

    def blind_then_real(conn, user_id, key):
        calls["n"] += 1
        return None if calls["n"] <= 4 else real(conn, user_id, key)  # both checks of both requests miss

    monkeypatch.setattr(orders_api, "_find_by_idempotency_key", blind_then_real)
    first = post_with_key(client, "blind-key", items)
    second = post_with_key(client, "blind-key", items)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"]
    assert scalar(db_path, "SELECT COUNT(*) FROM orders WHERE idempotency_key = 'blind-key'") == 1
    assert stock(db_path, urea["id"]) == urea["stock"] - 2

    conn = connect(db_path)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO orders (customer_id, placed_by, idempotency_key) VALUES (?, ?, 'blind-key')",
                     (me["customer_id"], me["id"]))
    conn.close()


# --- status changes -------------------------------------------------------------------

def place(client, db_path, sku="FT-UREA-45", quantity=5, **extra):
    response = new_order(client, [{"product_id": product(db_path, sku)["id"], "quantity": quantity}], **extra)
    assert response.status_code == 201, response.text
    return response.json()


def set_status(client, order_id, status):
    return client.put(f"/api/orders/{order_id}", json={"order_status": status})


def test_full_status_flow(client, db_path):
    login_as(client, OPS)
    order = place(client, db_path, customer_id=customer_id(db_path, "SUN-001"))
    previous = "placed"
    for step in ("confirmed", "packed", "shipped", "delivered"):
        response = set_status(client, order["id"], step)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["order_status"] == step
        assert body["events"][-1] == {**body["events"][-1], "from_status": previous, "to_status": step,
                                      "changed_by_name": "Meera Iyer"}
        previous = step
    assert len(body["events"]) == 5
    for target in ("cancelled", "placed", "shipped"):
        assert set_status(client, order["id"], target).status_code == 422


def test_invalid_transitions(client, db_path):
    login_as(client, OPS)
    order = place(client, db_path, customer_id=customer_id(db_path, "SUN-001"))
    skip = set_status(client, order["id"], "packed")
    assert skip.status_code == 422 and "Allowed next status: confirmed, cancelled" in skip.json()["error"]
    assert set_status(client, order["id"], "placed").status_code == 422
    assert set_status(client, order["id"], "lost").status_code == 422
    assert scalar(db_path, "SELECT COUNT(*) FROM order_events WHERE order_id = ?", (order["id"],)) == 1

    for step in ("confirmed", "packed", "shipped"):
        assert set_status(client, order["id"], step).status_code == 200
    shipped = set_status(client, order["id"], "cancelled")
    assert shipped.status_code == 422 and "from shipped to cancelled" in shipped.json()["error"]
    assert set_status(client, 999999, "confirmed").json() == NOT_FOUND


@pytest.mark.parametrize("cancel_from", ["placed", "confirmed", "packed"])
def test_cancel_restores_stock(client, db_path, cancel_from):
    login_as(client, OPS)
    kit, urea = product(db_path, "EQ-DRP-KIT"), product(db_path, "FT-UREA-45")
    response = new_order(client, [{"product_id": kit["id"], "quantity": 2}, {"product_id": urea["id"], "quantity": 9}],
                         customer_id=customer_id(db_path, "GRN-002"))
    order = response.json()
    assert (stock(db_path, kit["id"]), stock(db_path, urea["id"])) == (kit["stock"] - 2, urea["stock"] - 9)
    for step in ("confirmed", "packed")[: ("placed", "confirmed", "packed").index(cancel_from)]:
        set_status(client, order["id"], step)
    cancelled = set_status(client, order["id"], "cancelled")
    assert cancelled.status_code == 200 and cancelled.json()["order_status"] == "cancelled"
    assert cancelled.json()["events"][-1]["from_status"] == cancel_from
    assert (stock(db_path, kit["id"]), stock(db_path, urea["id"])) == (kit["stock"], urea["stock"])


def test_customer_status_rules(client, db_path):
    login_as(client, SUNDARAM)
    urea = product(db_path, "FT-UREA-45")
    own = place(client, db_path)
    assert stock(db_path, urea["id"]) == urea["stock"] - 5

    confirm = set_status(client, own["id"], "confirmed")
    assert confirm.status_code == 403 and "Customers can only cancel" in confirm.json()["error"]

    cancelled = set_status(client, own["id"], "cancelled")
    assert cancelled.status_code == 200 and cancelled.json()["events"][-1]["changed_by_name"] == "Karthik Sundaram"
    assert stock(db_path, urea["id"]) == urea["stock"]

    second = place(client, db_path)
    login_as(client, OPS)
    assert set_status(client, second["id"], "confirmed").status_code == 200
    login_as(client, SUNDARAM)
    late = set_status(client, second["id"], "cancelled")
    assert late.status_code == 403 and "while it is placed" in late.json()["error"]

    greenfield_placed = scalar(db_path, "SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id "
                                        "WHERE c.customer_code = 'GRN-002' AND o.order_status = 'placed'")
    other = set_status(client, greenfield_placed, "cancelled")
    assert other.status_code == 404 and other.json() == NOT_FOUND
    assert scalar(db_path, "SELECT order_status FROM orders WHERE id = ?", (greenfield_placed,)) == "placed"


# --- WAL and the read-only MCP connection --------------------------------------------

def mcp_call(client, name, **arguments):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                         "params": {"name": name, "arguments": arguments}},
                           headers={"Authorization": f"Bearer {os.environ['MCP_API_KEY']}",
                                    "Accept": "application/json, text/event-stream"})
    result = response.json()["result"]
    assert not result.get("isError"), result
    return json.loads(result["content"][0]["text"])


def test_database_uses_wal(client, db_path):
    assert scalar(db_path, "PRAGMA journal_mode") == "wal"


def test_mcp_sees_api_writes(client, db_path):
    login_as(client, SUNDARAM)
    before = mcp_call(client, "search_orders", customer="SUN-001", limit=100)["total"]
    order = place(client, db_path, sku="SD-PDY-1121", quantity=3, client_network="offline_sync")

    seen = mcp_call(client, "get_order", order_id=order["id"])
    assert seen["status"] == "placed" and seen["total"] == order["total"]
    assert seen["client_network"] == "offline_sync"
    assert mcp_call(client, "search_orders", customer="SUN-001", limit=100)["total"] == before + 1

    set_status(client, order["id"], "cancelled")
    seen = mcp_call(client, "get_order", order_id=order["id"])
    assert seen["status"] == "cancelled"
    assert [h["to_status"] for h in seen["status_history"]] == ["placed", "cancelled"]


def test_mcp_reads_while_a_write_is_open(client, db_path):
    writer = connect(db_path)
    writer.execute("BEGIN IMMEDIATE")
    writer.execute("UPDATE products SET stock = stock + 1")
    try:
        result = mcp_call(client, "search_orders", limit=1)  # would block without WAL
        assert result["total"] == 25
    finally:
        writer.rollback()
        writer.close()
