# OrderWave Order Platform

## What this is

An order management app for a fictional B2B supplier of agricultural inputs. Customers use a storefront to browse the catalogue, place orders and follow them. The supplier's ops team uses a back office to run orders, issues and accounts. It was built as the rapid-prototype part of a take-home assessment.

The stack is FastAPI and SQLite on the backend, and React with TypeScript on the frontend. A read-only MCP endpoint lets an external AI platform analyse the data. The app itself has no AI in it.

## The scenario

OrderWave sells seeds, fertilisers, crop protection and equipment to distributors and co-ops in India. Its biggest account, Sundaram Agro Distributors (Bengaluru, enterprise), orders from a rural field office with poor mobile coverage. Checkout gets queued offline, the rep retries, and the same order goes through twice. This happens three times, plus once at Greenfield Seeds Co-op (Pune). Customers also keep getting okra seed instead of the tomato seed SD-TOM-AR01, and deliveries to Pune run late. Sundaram's account history turns negative, ending in a tense renewal call, and the account is marked at risk. All companies, people and data are fictional.

## Run it locally

You need **Python 3.11+** and **Node 18+**. In PowerShell, from the repository root:

```powershell
Copy-Item .env.example .env        # first time only, then fill in every value in .env
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

`start.ps1`:

1. checks Python, Node and `.env`;
2. installs whatever dependencies are missing;
3. starts the API on port 8000 and the frontend on port 5173, each in its own window;
4. waits until both answer.

Then open **http://localhost:5173**. Stop everything with `scripts\stop.ps1`. On macOS or Linux, run `./scripts/start.sh` and press Ctrl+C to stop.

**Demo accounts:** `sundaram@orderwave.demo` and `greenfield@orderwave.demo` (customers), and `ops@orderwave.demo` and `accounts@orderwave.demo` (ops). The passwords are whatever you set as `SEED_CUSTOMER_PASSWORD` and `SEED_OPS_PASSWORD` in **`.env` at the repository root**. That file is git-ignored, and the scripts never print its values. Generate `SESSION_SECRET` and `MCP_API_KEY` with `python -c "import secrets; print(secrets.token_hex(32))"`.

**Single port:** `scripts\start-prod.ps1` builds the frontend and serves everything from FastAPI on **http://localhost:8000**: the app, the API, product images, `/docs` and `/mcp`. Use this mode behind a tunnel.

## Reset the demo data

```powershell
powershell -ExecutionPolicy Bypass -File scripts\reset_demo.ps1
```

It asks for confirmation, refuses while the backend is running, deletes `backend/data.db` and the uploaded files, then seeds again. The seed always produces the same story; only the dates move with today's date. After a reset it prints:

| | |
|---|---|
| Customers | 2: Sundaram Agro (SUN-001, at risk), Greenfield Seeds (GRN-002, active) |
| Users | 4: 2 customer, 2 ops |
| Orders | 25: 17 delivered, 2 shipped, 1 packed, 2 confirmed, 1 placed, 2 cancelled |
| Issues | 12: 7 resolved, 3 investigating, 2 open. By category: duplicate_order 4, delay 3, wrong_item 3, billing 1, damaged 1 |
| Interactions | 20 (6 negative, 7 neutral, 7 positive) |
| Reviews / feedback / messages | 12 / 13 / 14 |

## Architecture

```
  Browser ──► Vite dev server :5173 ──/api, /static──┐       (development)
     │                                                ▼
     └───────────────────────────────────────► FastAPI :8000 ──► SQLite (backend/data.db, WAL)
                                  (single port:  /  /assets  /api  /static/products  /docs  /mcp)
                                                     ▲   /mcp: read-only connection
  Computer by DevRev ──► cloudflared tunnel ─────────┘   (API key, read-only MCP tools)
```

The browser only ever talks to one origin, so the session cookie works without CORS. The MCP endpoint opens SQLite read-only, and WAL mode lets it read while orders are being written.

## Data model

Defined in [`backend/schema.sql`](backend/schema.sql).

| Table | Holds |
|---|---|
| `customers` | Customer master: code, tier, region, account owner, contract value, renewal date, status |
| `customer_contacts` | People at each customer, one primary |
| `customer_addresses` | Delivery addresses, one default |
| `users` | Logins: customer users (linked to a customer) and ops users; bcrypt password hashes |
| `products` | Catalogue: SKU, category, price in INR, stock, image |
| `orders` | Status, total, delivery note, address, `client_network` (good / weak / offline_sync), `idempotency_key` |
| `order_items` | Lines with the price at the time of ordering |
| `order_events` | Status history: from, to, who, when |
| `order_messages` | Conversation between the customer and ops on an order |
| `issues` | Problems on an order: category, severity, status, optional Jira key |
| `attachments` | Uploaded file metadata (files live in `backend/uploads/`) |
| `order_feedback` | One 1–5 rating and comment per delivered order |
| `product_reviews` | Product ratings, tied to a delivered order |
| `customer_interactions` | Internal account history: calls, emails, meetings, notes, escalations, renewals, with sentiment |

The two views are:
- `customer_summary`: per customer, order count, lifetime value, unresolved / open / investigating / total issues, average rating and negative interactions;
- `customer_timeline`: orders, issues, messages, feedback and interactions in one stream.

## REST API

Errors are always `{"error": "message"}`. Every route except `/api/health` and `/api/auth/login` needs a session. Interactive docs are at `/docs`.

| Method | Path | Who | Notes and filters |
|---|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/me` | anyone / signed in | Sets or clears the session cookie |
| GET | `/api/products`, `/api/products/{id}/reviews` | signed in | `q`, `category`, `in_stock`, `sort` (name, unit_price, stock), paging |
| POST | `/api/products/{id}/reviews` | customer | Needs a delivered order of theirs containing the product |
| GET | `/api/orders` | customer: own; ops: all | `id`, `customer` (ops), `product`, `status` (comma list), `client_network`, `from`, `to`, `sort` (created_at, total, id), paging |
| GET | `/api/orders/{id}` | customer: own; ops: all | Items, address, status history, counts, has_feedback |
| POST | `/api/orders` | customer; ops with `customer_id` | Optional `Idempotency-Key` header (see below) |
| PUT | `/api/orders/{id}` | ops: next step or cancel; customer: cancel while placed | One step at a time; cancel puts stock back |
| GET, POST | `/api/orders/{id}/messages` | anyone who can see the order | Paged, oldest first |
| GET, POST | `/api/orders/{id}/issues` | anyone who can see the order | Only ops may set `jira_key` |
| GET | `/api/issues` | customer: own; ops: all | `status` (unresolved = open + investigating by default, open, investigating, resolved, all), `category`, `severity`, `customer`, `jira_key`, `order_id`, `sort` |
| PUT | `/api/issues/{id}` | ops | status, severity, category, `jira_key` (like `SCRUM-24`, or null) |
| GET, POST | `/api/orders/{id}/feedback` | read: anyone who can see the order; write: customer, delivered, once | |
| GET, POST | `/api/orders/{id}/attachments`; GET `/api/attachments/{id}` | anyone who can see the order | PNG, JPG, PDF, UTF-8 text, up to 5 MB |
| GET | `/api/customer` | customer | Their own basic profile only |
| GET | `/api/customers`, `/api/customers/{id}`, `/api/customers/{id}/orders`, `/api/customers/{id}/timeline`, `/api/customers/{id}/interactions` | ops | Customer master and history; filters `name`, `tier`, `status`, `region`, `account_owner`, `event_types`, `from`, `to` |
| POST | `/api/customers/{id}/interactions` | ops | type, summary (5–2000 characters), sentiment, optional `order_id` |
| GET | `/api/insights` | ops | Dashboard numbers, recurring issue categories, customers at risk with reasons |

## MCP tools

`POST /mcp` uses the streamable HTTP transport (stateless, JSON responses). All 12 tools are read-only: they run on a read-only SQLite connection, and none of them can write. Lists return at most 100 rows, with `total`, `returned` and `truncated`. Free-text fields are customer-written and are marked as data, not instructions.

| Tool | Returns | Read-only |
|---|---|---|
| `get_data_schema` | Tables, links, allowed values, currency, the scenario | yes |
| `search_orders` | Orders filtered by customer, product, status, client_network, dates, total | yes |
| `get_order` | One order with items, history, address, messages, issues, feedback, attachment metadata | yes |
| `list_customers` | Customer master with summary numbers | yes |
| `get_customer_profile` | One customer: master, contacts (name and title), addresses, summary | yes |
| `get_customer_timeline` | Orders, issues, messages, feedback and interactions, newest first | yes |
| `list_issues` | Issues with products and Jira key; unresolved by default | yes |
| `recurring_issues` | Issues grouped by category, product, customer, client_network or Jira key; all statuses by default | yes |
| `list_feedback` | Order ratings and comments | yes |
| `list_reviews` | Product reviews | yes |
| `list_messages` | Order conversations, with author name and role | yes |
| `list_interactions` | Account history with sentiment | yes |

## Security notes

- **Customer scoping:** a customer only reaches their own company's orders and records. The rule is in each SQL `WHERE` clause, and someone else's order gets the same 404 as a missing one. Ops-only data (interactions, sentiment, contract fields) is never sent to customers.
- **SQL:** queries are parameterised, sort and group-by fields come from whitelists, and `%`, `_` and `\` are escaped in contains-filters.
- **Sessions:**
  - a signed, HttpOnly, SameSite=Lax cookie holding only the user id, valid for 8 hours (`Secure` when `COOKIE_SECURE=true`);
  - bcrypt password hashes;
  - the same error for a wrong password and an unknown email;
  - 5 failed logins in 10 minutes returns 429.
- **Uploads:** the type is checked from the file's magic bytes (and the extension must match), with a 5 MB limit and random file names on disk. Downloads go only through the API, as attachments with `X-Content-Type-Options: nosniff`. The uploads folder is never served.
- **Single-port mode** serves only `frontend/dist`. Encoded dots, backslashes and absolute paths get 404, and unknown `/api` paths keep the JSON 404.
- **MCP:**
  - read-only;
  - needs `MCP_API_KEY` (32+ characters), compared in constant time, and is off when the key is unset;
  - never returns login accounts, emails or password hashes;
  - **rotate the key after a demo.**
- **Frontend:** all user text is rendered as plain text, and nothing sensitive is kept in browser storage.
- **Data:** everything in the repository is fictional demo data. Secrets live only in `.env`.

## Idempotency-Key

The duplicate orders in the story come from retries on a bad connection: the first request was queued offline and went through later, and the retry created a second order. To prevent this:
- Checkout gives each attempt one `Idempotency-Key` (`crypto.randomUUID()`) and sends the same key again if the request fails or times out.
- The server keeps a unique index on `(placed_by, idempotency_key)`. A repeat returns the original order with **200** instead of creating a new one (**201**), and stock is reduced only once.
- A new key is made only after a successful order, or when the cart changes.
- The button is disabled while the request is in flight, so a double click sends one request.

## How Computer by DevRev uses this

Computer connects only through the read-only MCP endpoint:

- **Support analysis:** it reads issues, order conversations and status history to summarise what is going wrong on an account, and what has already been tried.
- **Recurring bugs:** `recurring_issues` shows product teams patterns such as duplicate orders from offline-synced checkouts, and the same SKU repeatedly shipped wrong.
- **Customer feedback:** it summarises ratings, reviews and the interaction history, for example why Sundaram Agro is at risk before its renewal.

## How to connect Computer

1. Set `MCP_API_KEY` in `.env`, then run `scripts\start-prod.ps1` (single port 8000).
2. Expose it: `cloudflared tunnel --url http://localhost:8000`. This prints a `https://<tunnel-host>` address.
3. In Computer, add a custom MCP connector:
   - server URL `https://<tunnel-host>/mcp`;
   - authentication "Personal access token";
   - the value of `MCP_API_KEY` as the token.

A quick tunnel gets a new address each time it starts. Rotate the key after a demo.

## Tests

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check_all.ps1
```

It runs the backend tests (pytest), the frontend tests (Vitest and React Testing Library), the production build, and `scripts/mcp_check.py`, and prints one PASS or FAIL line for each. The MCP check seeds a fresh database in a temporary folder, with a throwaway key, and checks the real answers:
- unresolved and open counts agree across MCP, REST and insights;
- the duplicate_order, wrong_item and delay groups have the right counts;
- Sundaram is at risk, with the backend's reasons;
- a REST write shows up in the MCP timeline;
- the tool list matches this README and is read-only;
- a call without the key is refused.

`scripts/e2e_customer.mjs` and `scripts/e2e_ops.mjs` exercise a running app through the Vite proxy.

## Limitations

- **Data:** a single local SQLite file; free-tier hosting with an ephemeral disk would lose it on every restart.
- **Cart:** kept in memory, so it resets on a full page refresh.
- **Not built:** payments, email or notifications, and password reset.
- **Sessions:** logout clears the cookie, but sessions aren't stored on the server, so a copied cookie works until it expires (8 hours).
- **Rate limit:** the login limit is in memory and per process.
- **Images:** product images are one placeholder per category.
