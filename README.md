# OrderWave Order Platform

This is a take-home assessment: a customer storefront plus an ops back office for an agricultural inputs supplier. It has a REST API, a customer master with order history, feedback and interactions, and data exports for analysis by an external AI platform.

## Scenario

TODO

## Data model

SQLite, defined in [`backend/schema.sql`](backend/schema.sql).

- Customer master: `customers` (code, tier, region, account owner, contract value, renewal date, status), `customer_contacts`, `customer_addresses`, `customer_interactions`.
- Catalogue and orders: `products`, `orders` (with delivery address and the client's network state when the order was placed), `order_items`, `order_events` (status history).
- After the order: `order_messages`, `issues` (with an optional Jira key), `order_feedback`, `product_reviews`, `attachments`.
- Views: `customer_summary` (order count, lifetime value, open issues, average rating and negative interactions per customer) and `customer_timeline` (orders, issues, messages, feedback and interactions in one stream).

## API

TODO

## Run locally

See [`backend/README.md`](backend/README.md) for setting up the backend, seeding the demo data and starting the server.

## Tests

From `backend/`, run `pytest`. The tests seed a temporary database and check the data, its relationships and the views.

## Demo logins

TODO

## Live demo

TODO

## Connecting an external AI platform

The backend serves a read-only [MCP](https://modelcontextprotocol.io) server at `/mcp` (streamable HTTP, on the same port as the API). An external AI platform can add it as a custom connector and analyse the orders, customers, issues, feedback, reviews, conversations and interactions. It offers 12 read-only tools, from `get_data_schema` and `search_orders` to `recurring_issues` and `get_customer_timeline`. The tools use a read-only database connection, return at most 100 rows per call, and never expose login accounts, password hashes or user email addresses.

1. **Set a key.** `/mcp` is turned off until `MCP_API_KEY` is set to at least 32 characters:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   Put the result in `MCP_API_KEY` (see `.env.example`). It is a separate key from user logins, and it only gives read access.
2. **Start the server** from `backend/`: `uvicorn main:app --port 8000`. Check it with:

   ```bash
   python ../scripts/mcp_smoke.py http://localhost:8000
   ```
3. **Expose it with a tunnel**, for example:

   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```

   This prints a public `https://<tunnel-host>` address.
4. **Add the connector.** In the platform's custom connector dialog use:
   - Server URL: `https://<tunnel-host>/mcp`
   - Authentication type: **Personal access token**
   - Token: the value of `MCP_API_KEY`

   The server accepts the key as `Authorization: Bearer <key>`, `Authorization: token <key>` or `X-API-Key: <key>`.

Notes:

- A quick tunnel gets a new URL every time it restarts, so update the connector's server URL when that happens.
- Rotate `MCP_API_KEY` after a demo: set a new value and restart the server. The old key stops working immediately.

## How DevRev or AI could use this data

TODO
