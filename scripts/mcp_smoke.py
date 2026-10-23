"""Smoke test for the read-only MCP endpoint of a running server.

Usage:
    MCP_API_KEY=... python scripts/mcp_smoke.py [base_url]     (default http://localhost:8000)

Calls initialize, tools/list and one search_orders, then prints a short summary.
The key is read from the environment and never printed.
"""

import json
import os
import sys

import httpx


def rpc(client: httpx.Client, url: str, request_id: int, method: str, params: dict | None = None) -> dict:
    body = {"jsonrpc": "2.0", "id": request_id, "method": method, **({"params": params} if params else {})}
    response = client.post(url, json=body)
    if response.status_code != 200:
        sys.exit(f"{method}: HTTP {response.status_code} {response.text[:200]}")
    data = response.json()
    if "error" in data:
        sys.exit(f"{method}: JSON-RPC error {data['error']}")
    return data["result"]


def main() -> None:
    key = os.environ.get("MCP_API_KEY")
    if not key:
        sys.exit("Set MCP_API_KEY in the environment first.")
    base_url = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
    url = f"{base_url}/mcp"
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json, text/event-stream"}

    with httpx.Client(headers=headers, timeout=30) as client:
        init = rpc(client, url, 1, "initialize", {
            "protocolVersion": "2026-07-28",
            "capabilities": {},
            "clientInfo": {"name": "orderwave-mcp-smoke", "version": "1.0"},
        })
        print(f"Server:    {url}")
        print(f"initialize: {init['serverInfo']['name']} (protocol {init['protocolVersion']})")

        tools = rpc(client, url, 2, "tools/list")["tools"]
        print(f"tools/list: {len(tools)} tools")
        for tool in tools:
            print(f"  - {tool['name']}")

        result = rpc(client, url, 3, "tools/call", {
            "name": "search_orders", "arguments": {"client_network": "offline_sync", "limit": 5}})
        if result.get("isError"):
            sys.exit(f"search_orders failed: {result['content'][0]['text']}")
        data = json.loads(result["content"][0]["text"])
        print(f"search_orders(client_network=offline_sync, limit=5): total {data['total']}, "
              f"returned {data['returned']}, truncated {data['truncated']}")
        for order in data["orders"]:
            skus = ", ".join(f"{i['sku']} x{i['quantity']}" for i in order["items"])
            print(f"  #{order['order_id']:<3} {order['created_at']}  {order['customer']:<27} "
                  f"{order['status']:<10} INR {order['total']:>10,.0f}  {skus}")
    print("OK")


if __name__ == "__main__":
    main()
