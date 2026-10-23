import os

import pytest
from fastapi.testclient import TestClient

from main import app

INDEX = "<!doctype html><title>OrderWave test build</title><div id=root></div>"
APP_JS = "console.log('orderwave test bundle');"
SECRET = "not-for-the-browser"


@pytest.fixture
def dist(tmp_path, monkeypatch):
    """A fake frontend build, with a file next to it that must never be reachable."""
    build = tmp_path / "build" / "dist"
    (build / "assets").mkdir(parents=True)
    (build / "index.html").write_text(INDEX, encoding="utf-8")
    (build / "assets" / "app-1234.js").write_text(APP_JS, encoding="utf-8")
    (build / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    (tmp_path / "build" / "secret.txt").write_text(SECRET, encoding="utf-8")
    monkeypatch.setenv("ORDERWAVE_FRONTEND_DIST", str(build))
    monkeypatch.setenv("SERVE_FRONTEND", "1")
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(tmp_path / "fe.db"))
    monkeypatch.setenv("ORDERWAVE_UPLOADS_DIR", str(tmp_path / "uploads"))
    return build


@pytest.fixture
def client(dist):
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("path", ["/", "/login", "/shop", "/orders/5", "/ops", "/ops/customers/1", "/checkout?x=1"])
def test_browser_routes_get_index_html(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_assets_are_served_from_dist(client):
    response = client.get("/assets/app-1234.js")
    assert response.status_code == 200 and response.text == APP_JS
    assert "javascript" in response.headers["content-type"]
    assert "immutable" in response.headers["cache-control"]
    assert client.get("/favicon.svg").status_code == 200
    assert client.head("/").status_code == 200


def test_api_and_other_routes_are_not_shadowed(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/static/products/seeds.svg").headers["content-type"].startswith("image/svg+xml")
    assert "swagger" in client.get("/docs").text.lower()
    assert client.get("/openapi.json").json()["info"]["title"] == "OrderWave Order Platform"
    mcp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert mcp.status_code == 401 and mcp.json() == {"error": "Unauthorized"}
    assert client.get("/api/auth/me").json() == {"error": "Not authenticated"}
    assert client.get("/api/auth/login").status_code == 405  # wrong method stays 405


@pytest.mark.parametrize("path", [
    "/api/does-not-exist", "/api/", "/api", "/api/orders/x/y/z",
    "/static/nothing.svg", "/static/products/missing.svg", "/mcp/extra", "/docs/extra",
])
def test_reserved_paths_keep_the_json_404(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.json() == {"error": "Not Found"}
    assert INDEX not in response.text


@pytest.mark.parametrize("path", [
    "/assets/missing.js",
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/assets/..%5c..%5csecret.txt",
    "/..\\secret.txt",
    "/%5c..%5csecret.txt",
    "//etc/passwd.txt",
    "/%2Fetc%2Fpasswd.txt",
    "/C:/Windows/win.ini",
    "/C%3A%5CWindows%5Cwin.ini",
    "/uploads/anything.txt",
    "/index.html%00.js",
])
def test_traversal_and_odd_paths_are_404(client, path):
    response = client.get(path)
    assert response.status_code == 404, path
    assert SECRET not in response.text
    assert response.json() == {"error": "Not Found"}


def test_post_to_a_browser_route_is_not_index(client):
    response = client.post("/shop")
    assert response.status_code in (404, 405)
    assert INDEX not in response.text


def test_off_when_disabled(dist, monkeypatch):
    monkeypatch.setenv("SERVE_FRONTEND", "0")
    with TestClient(app) as c:
        assert c.get("/").status_code == 404
        assert c.get("/shop").json() == {"error": "Not Found"}


def test_off_without_a_build(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDERWAVE_FRONTEND_DIST", str(tmp_path / "missing"))
    monkeypatch.setenv("ORDERWAVE_DB_PATH", str(tmp_path / "fe.db"))
    monkeypatch.delenv("SERVE_FRONTEND", raising=False)
    with TestClient(app) as c:
        assert c.get("/").status_code == 404


def test_default_build_folder_is_frontend_dist():
    import frontend_static
    assert frontend_static.DEFAULT_DIST == frontend_static.BACKEND_DIR.parent / "frontend" / "dist"
    assert os.path.basename(frontend_static.DEFAULT_DIST) == "dist"
