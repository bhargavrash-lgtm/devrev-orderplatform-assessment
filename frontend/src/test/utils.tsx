import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { AppProviders, AppRoutes, createQueryClient } from "../App";
import type { User } from "../api";

type Reply = { status: number; body?: unknown };
type Handler = Reply | ((init: RequestInit | undefined) => Reply);

/**
 * Replace fetch with a table of "METHOD /path" -> reply. Unknown requests fail the test loudly.
 * Returns the mock so tests can inspect calls.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    const reply = typeof handler === "function" ? handler(init) : handler;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const NOT_LOGGED_IN: Reply = { status: 401, body: { error: "Not authenticated" } };

export const customerUser: User = {
  id: 3, email: "sundaram@orderwave.demo", full_name: "Karthik Sundaram", role: "customer", customer_id: 1,
};
export const opsUser: User = { id: 1, email: "ops@orderwave.demo", full_name: "Meera Iyer", role: "ops", customer_id: null };

export const ownCustomer = {
  id: 1, customer_code: "SUN-001", name: "Sundaram Agro Distributors", city: "Bengaluru", state: "Karnataka",
  addresses: [], contacts: [],
};

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
