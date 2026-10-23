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

## Frontend

React 18 with TypeScript, Vite, React Router, TanStack Query and Tailwind CSS, in [`frontend/`](frontend/). Needs Node 18 or newer.

**Install**

```bash
cd frontend
npm install
```

**Develop** (two terminals):

```bash
# Terminal 1: the API on port 8000 (from backend/, with the venv active and .env loaded)
uvicorn main:app --port 8000

# Terminal 2: the frontend on port 5173
cd frontend
npm run dev
```

Open http://localhost:5173. The Vite dev server forwards `/api` and `/static` to `http://localhost:8000`, so the browser only talks to one origin. The session cookie stays first-party, and the backend doesn't need CORS.

**Test and build**

```bash
npm test          # Vitest + React Testing Library
npm run build     # type-checks with tsc, then builds to frontend/dist
```

**Customer screens** (sign in as `sundaram@orderwave.demo` or `greenfield@orderwave.demo`):

- **Shop** (`/shop`): the catalogue, with category chips, an "in stock only" switch, sorting (name, price or stock), and the top-bar search (debounced, using the products API's `q` filter). Each card shows the price in INR and the stock. Clicking a card opens the product: a larger image, description, price, add to cart, and reviews with average, count, reviewer company and date. A customer can review a product from one of their delivered orders that contains it.
- **Cart**: a drawer from the top-bar cart button, with a live item count, a quantity stepper (1 up to the stock, at most 1000 per line as the API allows), remove, and subtotal. It lives in memory only, so it resets on a full page refresh, by design.
- **Checkout** (`/checkout`): the order summary, a delivery address picker from the customer's addresses, an optional delivery note, and "Connection when ordering". That last one is saved as the order's `client_network`; it simulates a field rep ordering on poor coverage, which is how the duplicate orders in the demo data happen. Placing the order shows a confirmation with the order id, items and total.
- **My orders** (`/orders`): a table (cards on phones) with filters for order number, status and date range, sent to the orders API as `id`, `status`, `from` and `to`; paged.
- **Order** (`/orders/:id`): status, total, delivery address and note, a progress timeline from the order's status history, the items, and tabs:
  - Conversation: a message thread with support; Ctrl + Enter sends.
  - Issues: issues with severity, status and any Jira key, plus a "Report an issue" form.
  - Attachments: drag and drop or pick a file. PNG, JPG, PDF or text up to 5 MB, the same limits the server checks; downloads go through the API.
  - Feedback: a 1 to 5 star rating and comment, once per delivered order.

  Someone else's order shows the same not-found page as a missing one.

**How the Idempotency-Key works.** Each checkout attempt gets one key from `crypto.randomUUID()`, kept in the checkout page's state and sent as the `Idempotency-Key` header.

- **Retries reuse it.** If the request fails or times out (30 seconds), "Try again" sends the same key. If the first request did reach the server, the API returns that order (200) instead of creating a second one.
- **A double click sends one request.** The button is disabled, and a guard blocks a second submit while one is in flight.
- **A new key** is made only after a successful order, or when the cart contents change.

`node scripts/e2e_customer.mjs` runs the customer flow against the running app; it needs `SEED_CUSTOMER_PASSWORD` in the environment.

Notes:

- Design tokens (colours, radii, shadows, spacing, type scale) are defined once, in `frontend/tailwind.config.ts`.
- The shared components are in `frontend/src/components/ui`.
- User-written text is always rendered as plain text, and nothing sensitive is stored in the browser.
- The only session state is the backend's HTTP-only cookie.

## Tests

- Backend: from `backend/`, run `pytest`. The tests seed a temporary database and check the data, its relationships, the views, the API and the MCP server.
- Frontend: from `frontend/`, run `npm test`.

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
