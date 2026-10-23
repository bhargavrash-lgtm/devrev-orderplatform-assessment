import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { AppProviders, AppRoutes, createQueryClient } from "../App";
import type { Order, Product, User } from "../api";

type Reply = { status: number; body?: unknown };
export type Handler = Reply | ((init: RequestInit | undefined, url: URL) => Reply | Promise<Reply>);

/**
 * Replace fetch with a table of "METHOD /path" -> reply. A handler may be a function of the
 * request (and may throw, to simulate a network failure). Unknown requests fail loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    const reply = typeof handler === "function" ? await handler(init, url) : handler;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Calls made to one "METHOD /path", with their parsed URL and request options. */
export function callsTo(fetchMock: ReturnType<typeof mockApi>, method: string, path: string) {
  return fetchMock.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input), "http://localhost"), init: init as RequestInit | undefined }))
    .filter(({ url, init }) => (init?.method ?? "GET") === method && url.pathname === path);
}

export const NOT_LOGGED_IN: Reply = { status: 401, body: { error: "Not authenticated" } };

export const customerUser: User = {
  id: 3, email: "sundaram@orderwave.demo", full_name: "Karthik Sundaram", role: "customer", customer_id: 1,
};
export const opsUser: User = { id: 1, email: "ops@orderwave.demo", full_name: "Meera Iyer", role: "ops", customer_id: null };

export const ownCustomer = {
  id: 1, customer_code: "SUN-001", name: "Sundaram Agro Distributors", city: "Bengaluru", state: "Karnataka",
  addresses: [
    { id: 1, label: "Bengaluru warehouse", line1: "Plot 14, KIADB Industrial Area", city: "Bengaluru", state: "Karnataka", pincode: "562111", is_default: true },
    { id: 2, label: "Hosakote field office", line1: "Survey No. 112, Old Madras Road", city: "Hosakote", state: "Karnataka", pincode: "562114", is_default: false },
  ],
  contacts: [],
};

export const urea: Product = {
  id: 6, sku: "FT-UREA-45", name: "Neem-Coated Urea (45 kg)", category: "Fertilisers",
  description: "46% nitrogen, neem coated for slow release.", unit_price: 267, stock: 1200, image_url: "/static/products/fertilisers.svg",
};
export const sprayer: Product = {
  id: 17, sku: "EQ-BSP-16", name: "Battery Sprayer 16 L", category: "Equipment",
  description: "12 V rechargeable sprayer.", unit_price: 3200, stock: 3, image_url: "/static/products/equipment.svg",
};

export function page<T>(items: T[], extra: Record<string, unknown> = {}) {
  return { items, page: 1, page_size: 20, total: items.length, ...extra };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 5, customer: { id: 1, name: "Sundaram Agro Distributors" }, order_status: "placed", client_network: "good",
    total: 2670, delivery_note: null, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", item_count: 1,
    items: [{ product_id: urea.id, sku: urea.sku, name: urea.name, quantity: 10, unit_price: 267 }],
    address: { label: "Bengaluru warehouse", line1: "Plot 14", city: "Bengaluru", state: "Karnataka", pincode: "562111" },
    events: [{ from_status: null, to_status: "placed", changed_by_name: "Karthik Sundaram", created_at: "2026-10-20T10:00:00Z" }],
    counts: { messages: 0, issues: 0, attachments: 0 },
    has_feedback: false,
    ...overrides,
  };
}

/** A signed-in customer with a small catalogue; add or override routes per test. */
export function customerRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/auth/me": { status: 200, body: customerUser },
    "GET /api/customer": { status: 200, body: ownCustomer },
    "GET /api/products": { status: 200, body: page([urea, sprayer]) },
    "GET /api/orders": { status: 200, body: page([]) },
    ...extra,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

export function renderApp(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders queryClient={queryClient}>
        <AppRoutes />
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
}
