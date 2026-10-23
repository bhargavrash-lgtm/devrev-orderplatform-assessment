"""Check the MCP endpoint's real answers against freshly seeded demo data.

Usage: backend/.venv/Scripts/python.exe scripts/mcp_check.py      (or backend/.venv/bin/python)

Safe to run any time: it builds a brand-new database in a temporary folder, seeds it, and talks
to the real app in-process (REST API and /mcp over HTTP). Your backend/data.db, uploads and
.env are never read or changed. It uses a throwaway MCP key and passwords generated for this run,
and prints none of them. Exit code 0 means every check passed.
"""

import json
import logging
import os
import re
import secrets
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

TMP = Path(tempfile.mkdtemp(prefix="orderwave-mcp-check-"))
MCP_KEY = secrets.token_hex(32)
OPS_PASSWORD = secrets.token_urlsafe(16)
os.environ.update(
    ORDERWAVE_DB_PATH=str(TMP / "check.db"),
    ORDERWAVE_UPLOADS_DIR=str(TMP / "uploads"),
    SESSION_SECRET=secrets.token_hex(32),
    MCP_API_KEY=MCP_KEY,
    SEED_OPS_PASSWORD=OPS_PASSWORD,
    SEED_CUSTOMER_PASSWORD=secrets.token_urlsafe(16),
    SERVE_FRONTEND="0",
)
logging.disable(logging.WARNING)  # keep the output to the checks

from fastapi.testclient import TestClient  # noqa: E402

import seed  # noqa: E402
from db import connect, init_db  # noqa: E402
from main import app  # noqa: E402

WRITE_WORDS = re.compile(r"(create|add|update|set|delete|remove|post|put|write|insert|edit|cancel|upload)", re.I)
failures = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))


def readme_tools() -> set[str]:
    """Tool names from the README's "MCP tools" table (first column, in backticks)."""
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    match = re.search(r"^## MCP tools\s*$(.*?)(?=^## )", text, re.M | re.S)
    if not match:
        return set()
    return set(re.findall(r"^\|\s*`([a-z_]+)`\s*\|", match.group(1), re.M))


def main() -> int:
    init_db()
    conn = connect()
    seed.seed(conn, os.environ["SEED_OPS_PASSWORD"], os.environ["SEED_CUSTOMER_PASSWORD"])
    conn.close()
    print(f"Fresh demo database in a temporary folder; real data untouched. Throwaway MCP key (not shown).\n")

    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {MCP_KEY}", "Accept": "application/json, text/event-stream"}

        def rpc(method: str, params: dict | None = None, auth: dict | None = headers):
            body = {"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params else {})}
            return client.post("/mcp", json=body, headers=auth if auth is not None else {"Accept": headers["Accept"]})

        def tool(tool_name: str, **arguments):
            result = rpc("tools/call", {"name": tool_name, "arguments": arguments}).json()["result"]
            if result.get("isError"):
                raise RuntimeError(result["content"][0]["text"])
            return json.loads(result["content"][0]["text"])

        # --- access ---
        no_key = rpc("tools/list", auth={})
        wrong_key = rpc("tools/list", auth={"Authorization": "Bearer " + "0" * 64, "Accept": headers["Accept"]})
        check("a call without the key is refused", no_key.status_code == 401 and no_key.json() == {"error": "Unauthorized"},
              f"{no_key.status_code} {no_key.json()}")
        check("a call with a wrong key is refused", wrong_key.status_code == 401, str(wrong_key.status_code))

        # --- read-only surface ---
        tools = rpc("tools/list").json()["result"]["tools"]
        names = {t["name"] for t in tools}
        documented = readme_tools()
        check("tool list matches the README", names == documented and len(names) == 12,
              f"{len(names)} tools; missing from README: {sorted(names - documented) or 'none'}; "
              f"in README only: {sorted(documented - names) or 'none'}")
        check("every tool is marked read-only", all(t.get("annotations", {}).get("readOnlyHint") is True for t in tools))
        writers = sorted(n for n in names if WRITE_WORDS.search(n))
        check("no tool can write", not writers, f"tools with write-like names: {writers or 'none'}")

        # --- REST as ops, to compare ---
        login = client.post("/api/auth/login", json={"email": "ops@orderwave.demo", "password": OPS_PASSWORD})
        check("REST login as ops", login.status_code == 200)
        insights = client.get("/api/insights").json()
        rest_unresolved = client.get("/api/issues").json()  # default status: unresolved
        rest_open = client.get("/api/issues", params={"status": "open"}).json()

        # --- unresolved vs open, three ways ---
        mcp_unresolved = tool("list_issues", limit=100)
        mcp_open = tool("list_issues", status="open", limit=100)
        insights_unresolved = sum(insights["unresolved_issues_by_category"].values())
        insights_open = insights["issues_by_status"].get("open", 0)
        summary_unresolved = sum(c["summary"]["unresolved_issues"] for c in tool("list_customers")["customers"])
        check("unresolved issues agree (MCP, REST, insights, customer summaries)",
              mcp_unresolved["total"] == rest_unresolved["total"] == insights_unresolved == summary_unresolved,
              f"MCP {mcp_unresolved['total']}, REST {rest_unresolved['total']}, insights {insights_unresolved}, "
              f"summaries {summary_unresolved}")
        check("open issues agree (MCP, REST, insights)",
              mcp_open["total"] == rest_open["total"] == insights_open,
              f"MCP {mcp_open['total']}, REST {rest_open['total']}, insights {insights_open}")
        check("open is a subset of unresolved", 0 < mcp_open["total"] < mcp_unresolved["total"]
              and {i["issue_id"] for i in mcp_open["issues"]} < {i["issue_id"] for i in mcp_unresolved["issues"]},
              f"{mcp_open['total']} open < {mcp_unresolved['total']} unresolved (open + investigating)")

        # --- recurring issues ---
        recurring = tool("recurring_issues")
        groups = {g["group"]: g["issue_count"] for g in recurring["groups"]}
        expected = {"duplicate_order": 4, "wrong_item": 3, "delay": 3}
        check("recurring issues: duplicate_order 4, wrong_item 3, delay 3",
              groups == expected and recurring["status_filter"] == "all", f"{groups}, status_filter {recurring['status_filter']}")
        by_product = {g["group"]: g for g in tool("recurring_issues", group_by="product")["groups"]}
        check("the wrong item is always the same product",
              by_product.get("SD-TOM-AR01", {}).get("categories") == ["wrong_item"], "SD-TOM-AR01 (tomato seed)")
        by_network = {g["group"]: g for g in tool("recurring_issues", group_by="client_network")["groups"]}
        check("duplicates come from offline-synced orders",
              by_network.get("offline_sync", {}).get("categories") == ["duplicate_order"],
              f"offline_sync group: {by_network.get('offline_sync', {}).get('issue_count')} issues")

        # --- at-risk customer ---
        at_risk = {c["customer_code"]: c for c in insights["customers_at_risk"]}
        sun = at_risk.get("SUN-001", {})
        expected_reasons = ["status is at_risk", "5 negative interactions in the last 90 days"]
        check("Sundaram Agro is at risk, with the backend's reasons",
              sun.get("name") == "Sundaram Agro Distributors" and sun.get("reasons") == expected_reasons,
              "; ".join(sun.get("reasons", [])))
        mcp_risk = [c["customer_code"] for c in tool("list_customers", status="at_risk")["customers"]]
        check("MCP lists the same at-risk account", mcp_risk == ["SUN-001"], str(mcp_risk))

        # --- a REST write shows up in the MCP timeline ---
        summary = "Check: walked Karthik through the offline duplicate-order fix."
        sun_id = client.get("/api/customers", params={"name": "Sundaram"}).json()["items"][0]["id"]
        added = client.post(f"/api/customers/{sun_id}/interactions",
                            json={"interaction_type": "meeting", "sentiment": "positive", "summary": summary})
        timeline = tool("get_customer_timeline", name="SUN-001", event_types=["meeting"], limit=5)
        check("an interaction added through REST appears in the MCP timeline",
              added.status_code == 201 and timeline["events"][0]["summary"] == summary,
              f"REST {added.status_code}; newest meeting via MCP: {timeline['events'][0]['event_at']}")

        # --- the MCP connection can't write ---
        before = tool("list_interactions", customer="SUN-001")["total"]
        bogus = rpc("tools/call", {"name": "add_interaction", "arguments": {"summary": "x"}}).json()["result"]
        after = tool("list_interactions", customer="SUN-001")["total"]
        check("calling a write tool that doesn't exist changes nothing", bogus.get("isError") is True and before == after,
              f"interactions before {before}, after {after}")

    print("\n" + (f"{failures} check(s) failed" if failures else "All MCP checks passed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
