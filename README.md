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

## How DevRev or AI could use this data

TODO
