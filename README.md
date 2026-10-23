# OrderWave Order Platform

This is a take-home assessment: a customer storefront plus an ops back office for an agricultural inputs supplier. It has a REST API, a customer master with order history, feedback and interactions, and data exports for analysis by an external AI platform.

## Scenario

TODO

## Data model

SQLite, defined in [`backend/schema.sql`](backend/schema.sql).

- Customer master: `customers` (code, tier, region, account owner, contract value, renewal date, status), `customer_contacts`, `customer_addresses`, `customer_interactions`.
- Catalogue and orders: `products`, `orders` (with delivery address and the client's network state when the order was placed), `order_items`, `order_events` (status history).
- After the order: `order_messages`, `issues` (with an optional Jira key), `order_feedback`, `product_reviews`, `attachments`.
- Views: `customer_summary` (order count, lifetime value, issue counts, average rating and negative interactions per customer; `unresolved_issues` means open or investigating, and `open_issues_only` counts only newly reported issues not yet being worked on) and `customer_timeline` (orders, issues, messages, feedback and interactions in one stream).

## API

JSON over HTTP, served by the backend. Every route except `/api/health` and `/api/auth/login` needs a session cookie from logging in. Errors always have the shape `{"error": "message"}`.

| Method | Path | Who can call it | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | anyone | Health check |
| `POST` | `/api/auth/login` | anyone | Log in with email and password; sets the session cookie |
| `POST` | `/api/auth/logout` | anyone | Clear the session cookie |
| `GET` | `/api/auth/me` | logged-in user | The current user |
| `GET` | `/api/products` | logged-in user | Catalogue. Filters `q` (name or SKU), `category`, `in_stock`; `sort` = `name`, `unit_price`, `stock` (prefix `-` for descending); paged |
| `GET` | `/api/orders` | customer: own orders; ops: all | Order list with items. Filters `id`, `customer` (ops only), `product`, `status` (comma-separated), `client_network`, `from` / `to` (YYYY-MM-DD, inclusive); `sort` = `created_at`, `total`, `id`; paged |
| `GET` | `/api/orders/{id}` | customer: own orders; ops: all | One order with items, address, status history, counts of messages, issues and attachments, and whether it has feedback |
| `POST` | `/api/orders` | customer (for themselves); ops (with `customer_id`) | Place an order: checks stock, copies current prices, writes the first status event and reduces stock in one transaction |
| `PUT` | `/api/orders/{id}` | ops: any allowed step; customer: cancel own order while `placed` | Change status along placed → confirmed → packed → shipped → delivered, one step at a time, or cancel from placed, confirmed or packed (cancelling puts the stock back) |
| `GET` | `/api/orders/{id}/messages` | anyone who can see the order | Order conversation, oldest first; paged (default 50) |
| `POST` | `/api/orders/{id}/messages` | anyone who can see the order | Post a message (1 to 2000 characters; stored as plain text) |
| `GET` | `/api/orders/{id}/issues` | anyone who can see the order | Issues reported on the order |
| `POST` | `/api/orders/{id}/issues` | anyone who can see the order | Report an issue (category, severity, description); only ops may set `jira_key` |
| `GET` | `/api/issues` | customer: own issues; ops: all | Issues across orders. `status` = `unresolved` (default: open or investigating), `open`, `investigating`, `resolved`, `all`; filters `category`, `severity`, `customer` (ops only), `jira_key`, `order_id`; `sort` = `created_at`, `severity`, `status`; paged |
| `PUT` | `/api/issues/{id}` | ops | Change an issue's status, severity, category or `jira_key` (format `ABC-123`, or null) |
| `GET` | `/api/orders/{id}/feedback` | anyone who can see the order | The order's feedback, or 404 |
| `POST` | `/api/orders/{id}/feedback` | customer, own delivered order | Rate the order 1 to 5 with an optional comment; once per order (409 after that) |
| `GET` | `/api/products/{id}/reviews` | logged-in user | Product reviews with the average rating and count; paged |
| `POST` | `/api/products/{id}/reviews` | customer | Review a product from one of their delivered orders that contains it; once per product per order (409 after that) |
| `GET` | `/api/orders/{id}/attachments` | anyone who can see the order | Attachment metadata (no file contents) |
| `POST` | `/api/orders/{id}/attachments` | anyone who can see the order | Upload a file (multipart `file`, optional `issue_id` on the same order). PNG, JPG, PDF or UTF-8 text, checked by content; up to 5 MB |
| `GET` | `/api/attachments/{id}` | anyone who can see the order | Download as an attachment, with `X-Content-Type-Options: nosniff` |
| `GET` | `/api/customer` | customer | Their own basic profile: code, name, city, state, addresses, and contacts (name, title, primary) |
| `GET` | `/api/customers` | ops | Customer master with summary numbers and account owner. Filters `name`, `tier`, `status`, `region`, `account_owner`; `sort` = `name`, `lifetime_value`, `last_order_at`, `unresolved_issues`, `avg_rating`; paged |
| `GET` | `/api/customers/{id}` | ops | One customer: master, summary numbers, contacts (with email and phone), addresses, account owner |
| `GET` | `/api/customers/{id}/orders` | ops | That customer's orders, with the same shape and filters as `GET /api/orders` |
| `GET` | `/api/customers/{id}/timeline` | ops | Orders, issues, messages, feedback and interactions in one stream, newest first. Filters `event_types` (comma-separated), `from`, `to`; paged (up to 200) |
| `GET` | `/api/customers/{id}/interactions` | ops | Account history (calls, emails, meetings, notes, escalations, renewal talks). Filters `interaction_type`, `sentiment`, `from`, `to`; newest first; paged |
| `POST` | `/api/customers/{id}/interactions` | ops | Log an interaction: type, summary (5 to 2000 characters), sentiment (default neutral), optional `order_id` of that customer |
| `GET` | `/api/insights` | ops | Orders by status and client network, unresolved issues by category and severity, issues by status, feedback average and rating distribution, top customers by unresolved issues, recurring issue categories, the 10 latest events, and customers at risk with reasons |
| `POST` | `/mcp` | holder of `MCP_API_KEY` | Read-only MCP server for an external AI platform (see below) |

List responses look like `{"items": [...], "page": 1, "page_size": 20, "total": 25}`. `page_size` is at most 100.

A customer asking for another customer's order gets the same 404 as for an order that does not exist. The same goes for that order's messages, issues, feedback and attachments. The customer rule is part of every query's SQL, not a check applied afterwards.

**Internal customer data.** Account information is for ops only: interactions, the timeline, sentiment, account owner, contract value, renewal date, status, tier and summary numbers. A customer user gets 403 on every `/api/customers...` route and on `/api/insights`. Their only customer endpoint is `/api/customer`, which returns their own basic profile.

**Attachments.** An upload's type comes from the file's content (magic bytes, or valid UTF-8 for text), and its extension has to match. Files are stored in `backend/uploads/` under random server-made names. The original filename is kept, with any path parts removed, only in the database, for display and downloads. The folder is never served directly: files are only downloaded through `/api/attachments/{id}`, after the same access check as the order.

**Idempotency-Key.** `POST /api/orders` accepts an optional `Idempotency-Key` header (up to 100 characters). The first request with a key creates the order and returns 201. A repeat from the same user with the same key creates nothing and returns the original order with 200, so a client on a weak connection can safely retry. A unique index on `(placed_by, idempotency_key)` also stops two simultaneous requests with the same key, and stock is only reduced once.

**WAL mode.** The database runs in SQLite's write-ahead-log mode, switched on at startup. Readers, including the MCP server's read-only connection, see the last committed data while an order is being written, instead of waiting for the write to finish.

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
