"""Single-port mode: serve the built frontend (frontend/dist) from the API.

It never shadows the API. It only answers requests that matched no route (would be a 404):
- reserved paths (/api, /static, /mcp, /docs, /redoc, /openapi.json) keep their own 404s;
- a path whose last part has a dot (/assets/app.js, /favicon.svg) is a file in dist, or a 404;
- any other GET path (/shop, /ops/customers/1) gets index.html, and the frontend router takes over.

Paths with "..", backslashes, drive letters or a doubled leading slash are refused (404).

Turned on when frontend/dist/index.html exists, or forced with SERVE_FRONTEND=1;
SERVE_FRONTEND=0 turns it off. ORDERWAVE_FRONTEND_DIST points at another build folder.
"""

import logging
import os
from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, Response

from db import BACKEND_DIR

logger = logging.getLogger("orderwave.frontend")

DEFAULT_DIST = BACKEND_DIR.parent / "frontend" / "dist"
RESERVED = {"api", "static", "mcp", "docs", "redoc", "openapi.json"}
SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff"}


def _dist_dir() -> Path:
    return Path(os.environ.get("ORDERWAVE_FRONTEND_DIST", DEFAULT_DIST))


def frontend_dist() -> Path | None:
    """The build folder to serve, or None when single-port mode is off or there is no build."""
    if os.environ.get("SERVE_FRONTEND", "").strip() == "0":
        return None
    dist = _dist_dir()
    return dist if (dist / "index.html").is_file() else None


def log_startup_state() -> None:
    forced = os.environ.get("SERVE_FRONTEND", "").strip() == "1"
    if frontend_dist() is not None:
        logger.warning("Serving the built frontend from %s at /", _dist_dir())
    elif forced:
        logger.warning("SERVE_FRONTEND=1 but %s has no index.html; run `npm run build` in frontend/ first.", _dist_dir())


def frontend_response(request: Request) -> Response | None:
    """The file or index.html for an unmatched GET, or None to keep the normal 404."""
    if request.method not in ("GET", "HEAD"):
        return None
    dist = frontend_dist()
    if dist is None:
        return None

    path = request.scope.get("path", "")  # already percent-decoded by the server
    if not path.startswith("/") or path.startswith("//"):
        return None
    relative = path[1:]
    if "\\" in relative or ":" in relative or "\x00" in relative:
        return None
    parts = relative.split("/")
    if parts[0] in RESERVED or any(part in ("..", ".") for part in parts):
        return None

    last = parts[-1]
    if relative == "" or "." not in last:
        return FileResponse(dist / "index.html", media_type="text/html",
                            headers={**SECURITY_HEADERS, "Cache-Control": "no-cache"})

    root = dist.resolve()
    candidate = (dist / relative).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    cache = "public, max-age=31536000, immutable" if parts[0] == "assets" else "no-cache"
    return FileResponse(candidate, headers={**SECURITY_HEADERS, "Cache-Control": cache})
