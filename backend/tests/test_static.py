import pytest
from fastapi.testclient import TestClient

from db import BACKEND_DIR
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(tmp_path / "static.db"))
    monkeypatch.setenv("ORDERWAVE_UPLOADS_DIR", str(tmp_path / "uploads"))
    with TestClient(app) as c:
        yield c


def test_product_image_loads(client):
    response = client.get("/static/products/seeds.svg")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.content == (BACKEND_DIR / "static" / "products" / "seeds.svg").read_bytes()


@pytest.mark.parametrize("path", [
    "/static/products/../../schema.sql",
    "/static/products/%2e%2e/%2e%2e/schema.sql",
    "/static/products/..%2f..%2fschema.sql",
    "/static/products/%2e%2e%5c%2e%2e%5cschema.sql",
    "/static/products/..\\..\\schema.sql",
    "/static/products/%2fetc%2fhosts",
])
def test_path_traversal_is_404(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert b"CREATE TABLE" not in response.content


@pytest.mark.parametrize("path", [
    "/static/products/",  # no directory listing
    "/static/products",
    "/static/products/missing.svg",
    "/static/",
    "/static/other.svg",
    "/static/products.svg",
    "/uploads/anything.txt",
])
def test_nothing_else_is_served(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.json() == {"error": "Not Found"}


def test_static_is_read_only(client):
    assert client.post("/static/products/seeds.svg", content=b"x").status_code in (404, 405)
    assert client.put("/static/products/new.svg", content=b"x").status_code in (404, 405)
