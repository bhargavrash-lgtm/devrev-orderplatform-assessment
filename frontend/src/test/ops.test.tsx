import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CustomerDetail, Insights, Interaction, Issue, Order } from "../api";
import { callsTo, customerRoutes, makeOrder, mockApi, opsUser, page, renderApp, type Handler } from "./utils";

const location = () => screen.getByTestId("location").textContent;
const search = () => new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
const user = () => userEvent.setup();
const EVIL = "<img src=x onerror=alert(1)>";

const insightsFixture: Insights = {
  orders_by_status: { placed: 1, confirmed: 3, packed: 1, shipped: 2, delivered: 17, cancelled: 2 },
  orders_by_client_network: { good: 13, offline_sync: 8, weak: 4 },
  unresolved_issues_by_category: { duplicate_order: 1, wrong_item: 1, delay: 2, billing: 1 },
  unresolved_issues_by_severity: { high: 2, medium: 2, low: 1 },
  issues_by_status: { open: 2, investigating: 3, resolved: 7 },
  feedback: { average_rating: 3.31, count: 13, ratings_distribution: { "1": 2, "2": 2, "3": 3, "4": 2, "5": 4 } },
  top_customers_by_unresolved_issues: [{ customer_id: 2, name: "Greenfield Seeds Co-op", unresolved_issues: 3, open_issues_only: 1, investigating_issues: 2 }],
  recurring_issues_by_category: [
    { category: "duplicate_order", issue_count: 4, unresolved: 1, resolved: 3, customers_affected: ["Greenfield Seeds Co-op", "Sundaram Agro Distributors"] },
    { category: "wrong_item", issue_count: 3, unresolved: 1, resolved: 2, customers_affected: ["Greenfield Seeds Co-op", "Sundaram Agro Distributors"] },
  ],
  recent_events: [{ customer_id: 1, customer_name: "Sundaram Agro Distributors", event_type: "renewal", event_at: "2026-10-21T15:00:00Z", order_id: null, summary: "Renewal call" }],
  customers_at_risk: [{ customer_id: 1, customer_code: "SUN-001", name: "Sundaram Agro Distributors", renewal_date: "2027-01-31", unresolved_issues: 2,
    reasons: ["status is at_risk", "5 negative interactions in the last 90 days"] }],
  notes: { customers_at_risk: "status at_risk, or at least 2 negative interactions in the last 90 days" },
};

const sundaram: CustomerDetail = {
  id: 1, customer_code: "SUN-001", name: "Sundaram Agro Distributors", industry: "Agricultural inputs distribution", tier: "enterprise",
  region: "South India", city: "Bengaluru", state: "Karnataka", account_owner: { id: 2, name: "Rohan Kulkarni" },
  annual_contract_value: 4200000, currency: "INR", renewal_date: "2027-01-31", status: "at_risk", customer_since: "2024-10-23",
  contact_email: "orders@sundaram-agro.example",
  summary: { order_count: 14, lifetime_value: 508320, last_order_at: "2026-10-20T13:38:44Z", unresolved_issues: 2, open_issues_only: 1,
    investigating_issues: 1, total_issues: 6, avg_rating: 3.43, negative_interactions: 5, last_interaction_at: "2026-10-21T13:31:44Z" },
  contacts: [{ id: 1, full_name: "Karthik Sundaram", title: "Head of Purchasing", email: "karthik@sundaram-agro.example", phone: "+91 90000 11201", is_primary: true }],
  addresses: [{ id: 1, label: "Bengaluru warehouse", line1: "Plot 14", city: "Bengaluru", state: "Karnataka", pincode: "562111", is_default: true }],
};

const issue: Issue = {
  id: 13, order_id: 23, customer: { id: 1, name: "Sundaram Agro Distributors" }, category: "duplicate_order", severity: "high", status: "open",
  description: "Order went through twice again.", jira_key: null, reported_by_name: "Karthik Sundaram", created_at: "2026-10-23T15:38:14Z", products: [],
};

function opsRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/auth/me": { status: 200, body: opsUser },
    "GET /api/insights": { status: 200, body: insightsFixture },
    "GET /api/issues": { status: 200, body: { ...page([issue]), status_filter: "unresolved" } },
    "GET /api/orders": { status: 200, body: page([makeOrder({ id: 23 })]) },
    "GET /api/customers": { status: 200, body: page([sundaram]) },
    ...extra,
  };
}

describe("ops orders list", () => {
  it("sends the filters to the API and keeps them in the URL", async () => {
    const fetchMock = mockApi(opsRoutes());
    renderApp("/ops/orders?status=delivered");
    expect(await screen.findByRole("cell", { name: "#23" })).toBeInTheDocument();
    const lastQuery = () => callsTo(fetchMock, "GET", "/api/orders").at(-1)!.url.searchParams;
    // A shared or reloaded link applies its filters straight away.
    expect(callsTo(fetchMock, "GET", "/api/orders")[0]!.url.searchParams.get("status")).toBe("delivered");

    const u = user();
    await u.selectOptions(screen.getByLabelText("Status"), "shipped");
    await u.selectOptions(screen.getByLabelText("Connection"), "offline_sync");
    await u.type(screen.getByLabelText("Customer"), "Sundaram");
    await u.type(screen.getByLabelText("Product"), "SD-TOM");
    await u.type(screen.getByLabelText("Order #"), "23");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
    await u.selectOptions(screen.getByLabelText("Sort"), "-total");

    const expected = { status: "shipped", client_network: "offline_sync", customer: "Sundaram", product: "SD-TOM", id: "23",
      from: "2026-09-01", to: "2026-10-31", sort: "-total" };
    // Several 300 ms debounced filters: allow for a busy machine.
    await waitFor(() => expect(Object.fromEntries(lastQuery())).toEqual({ ...expected, page: "1", page_size: "25" }), { timeout: 5000 });
    expect(Object.fromEntries(search())).toEqual(expected);

    await u.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(Object.fromEntries(search())).toEqual({ sort: "-total" }));
  });
});

describe("ops order status", () => {
  function statusRoutes(putReply: (status: string) => { status: number; body: unknown }) {
    let current: Order = makeOrder({ id: 5, order_status: "placed" });
    const routes: Record<string, Handler> = opsRoutes({
      "GET /api/orders/5": () => ({ status: 200, body: current }),
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
      "PUT /api/orders/5": (init) => {
        const next = JSON.parse(String(init?.body)).order_status;
        const reply = putReply(next);
        if (reply.status === 200) current = { ...current, order_status: next };
        return reply.status === 200 ? { status: 200, body: current } : reply;
      },
    });
    return routes;
  }

  it("moves the order to the next status, refreshes it, and confirms before cancelling", async () => {
    const fetchMock = mockApi(statusRoutes(() => ({ status: 200, body: null })));
    renderApp("/ops/orders/5");
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Confirm order" }));
    expect(await screen.findByRole("button", { name: "Mark as packed" })).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, "PUT", "/api/orders/5")[0]!.init?.body))).toEqual({ order_status: "confirmed" });
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(callsTo(fetchMock, "GET", "/api/orders/5").length).toBeGreaterThanOrEqual(2);

    // Cancelling asks first.
    await u.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel order #5?" });
    await u.click(within(dialog).getByRole("button", { name: "Keep order" }));
    expect(callsTo(fetchMock, "PUT", "/api/orders/5")).toHaveLength(1);
    await u.click(screen.getByRole("button", { name: "Cancel order" }));
    await u.click(within(screen.getByRole("dialog", { name: "Cancel order #5?" })).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/api/orders/5")).toHaveLength(2));
    expect(JSON.parse(String(callsTo(fetchMock, "PUT", "/api/orders/5")[1]!.init?.body))).toEqual({ order_status: "cancelled" });
    expect(await screen.findByText("This order is closed; its status can't change.")).toBeInTheDocument();
  });

  it("shows the API's message when a change is refused", async () => {
    mockApi(statusRoutes(() => ({ status: 422, body: { error: "Cannot change an order from placed to confirmed. Allowed next status: none" } })));
    renderApp("/ops/orders/5");
    await user().click(await screen.findByRole("button", { name: "Confirm order" }));
    expect(await screen.findByText("Cannot change an order from placed to confirmed. Allowed next status: none", { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeInTheDocument();
  });

  it("labels ops replies and shows customer HTML as text", async () => {
    const messages = [{ id: 1, order_id: 5, author_name: "Karthik Sundaram", author_role: "customer", body: EVIL, created_at: "2026-10-20T11:00:00Z" }];
    const fetchMock = mockApi(opsRoutes({
      "GET /api/orders/5": { status: 200, body: makeOrder({ id: 5 }) },
      "GET /api/orders/5/messages": () => ({ status: 200, body: { items: messages, page: 1, page_size: 100, total: messages.length } }),
      "POST /api/orders/5/messages": (init) => {
        const message = { id: 2, order_id: 5, author_name: "Meera Iyer", author_role: "ops", body: JSON.parse(String(init?.body)).body, created_at: "2026-10-20T12:00:00Z" };
        messages.push(message);
        return { status: 201, body: message };
      },
    }));
    const { container } = renderApp("/ops/orders/5");
    expect(await screen.findByText(EVIL)).toBeInTheDocument();
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText(/Karthik Sundaram · customer/)).toBeInTheDocument();
    await user().type(screen.getByLabelText("Reply as the ops team"), "We'll cancel the duplicate today.");
    await user().click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("We'll cancel the duplicate today.")).toBeInTheDocument();
    expect(screen.getByText(/Meera Iyer · ops team/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/api/orders/5/messages")).toHaveLength(1);
  });
});

describe("issue editor", () => {
  it("rejects a badly formatted Jira key, then saves status and key", async () => {
    let current = { ...issue };
    const fetchMock = mockApi(opsRoutes({
      "GET /api/issues": () => ({ status: 200, body: { ...page([current]), status_filter: "unresolved" } }),
      "PUT /api/issues/13": (init) => {
        current = { ...current, ...JSON.parse(String(init?.body)) };
        return { status: 200, body: current };
      },
    }));
    renderApp("/ops/issues");
    const u = user();
    // The table renders a desktop table and a mobile list; CSS hides one, jsdom shows both.
    await u.click((await screen.findAllByRole("button", { name: "Edit issue 13" }))[0]!);
    const drawer = screen.getByRole("dialog", { name: "Issue #13" });
    const key = within(drawer).getByLabelText("Jira key");

    await u.type(key, "scrum 24");
    await u.click(within(drawer).getByRole("button", { name: "Save changes" }));
    expect(within(drawer).getByText(/Use the Jira format/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "PUT", "/api/issues/13")).toHaveLength(0);

    await u.clear(key);
    await u.type(key, "scrum-24");
    await u.selectOptions(within(drawer).getByLabelText("Status"), "investigating");
    await u.click(within(drawer).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/api/issues/13")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, "PUT", "/api/issues/13")[0]!.init?.body))).toEqual({ status: "investigating", jira_key: "SCRUM-24" });
    expect((await screen.findAllByText("SCRUM-24")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(fetchMock, "GET", "/api/issues").length).toBeGreaterThanOrEqual(2);
  });

  it("filters issues through the URL, defaulting to unresolved", async () => {
    const fetchMock = mockApi(opsRoutes());
    renderApp("/ops/issues");
    await screen.findAllByRole("button", { name: "Edit issue 13" });
    expect(callsTo(fetchMock, "GET", "/api/issues")[0]!.url.searchParams.get("status")).toBe("unresolved");
    await user().selectOptions(screen.getByLabelText("Severity"), "high");
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/api/issues").at(-1)!.url.searchParams.get("severity")).toBe("high"));
    expect(search().get("severity")).toBe("high");
  });
});

describe("customer 360", () => {
  it("adds an interaction, which shows in the list and the timeline", async () => {
    const interactions: Interaction[] = [{ id: 1, customer_id: 1, order_id: null, interaction_type: "note", sentiment: "neutral",
      summary: EVIL, created_by_name: "Rohan Kulkarni", created_at: "2026-10-01T10:00:00Z" }];
    const asPage = (items: unknown[]) => ({ items, page: 1, page_size: 20, total: items.length });
    const fetchMock = mockApi(opsRoutes({
      "GET /api/customers/1": { status: 200, body: sundaram },
      "GET /api/customers/1/orders": { status: 200, body: page([makeOrder({ id: 23 })]) },
      "GET /api/customers/1/interactions": () => ({ status: 200, body: asPage([...interactions].reverse()) }),
      "GET /api/customers/1/timeline": () => ({ status: 200, body: { customer_id: 1, ...asPage([...interactions].reverse().map((i) => ({
        event_type: i.interaction_type, event_at: i.created_at, order_id: i.order_id, summary: i.summary }))) } }),
      "POST /api/customers/1/interactions": (init) => {
        const body = JSON.parse(String(init?.body));
        const created: Interaction = { id: interactions.length + 1, customer_id: 1, created_by_name: "Meera Iyer", created_at: "2026-10-24T09:00:00Z", ...body };
        interactions.push(created);
        return { status: 201, body: created };
      },
    }));
    const { container } = renderApp("/ops/customers/1?tab=interactions");
    expect(await screen.findByRole("heading", { name: "Sundaram Agro Distributors" })).toBeInTheDocument();
    expect(await screen.findByText(EVIL)).toBeInTheDocument();
    expect(container.querySelector("img[src='x']")).toBeNull();

    const u = user();
    await u.click(screen.getByRole("button", { name: "Add interaction" }));
    const dialog = screen.getByRole("dialog", { name: "Add interaction" });
    await u.click(within(dialog).getByRole("button", { name: "Add interaction" }));
    expect(within(dialog).getByText("Choose the type of interaction.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/api/customers/1/interactions")).toHaveLength(0);

    await u.selectOptions(within(dialog).getByLabelText("Type"), "call");
    await u.selectOptions(within(dialog).getByLabelText("Sentiment"), "negative");
    await u.type(within(dialog).getByLabelText("Summary"), "Karthik wants the duplicate fix before renewal.");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /#23/ })).toBeInTheDocument());
    await u.selectOptions(within(dialog).getByLabelText("Related order (optional)"), "23");
    await u.click(within(dialog).getByRole("button", { name: "Add interaction" }));

    await waitFor(() => expect(callsTo(fetchMock, "POST", "/api/customers/1/interactions")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, "POST", "/api/customers/1/interactions")[0]!.init?.body))).toEqual({
      interaction_type: "call", sentiment: "negative", summary: "Karthik wants the duplicate fix before renewal.", order_id: 23,
    });
    const list = await screen.findByRole("list", { name: "Interactions" });
    expect(await within(list).findByText("Karthik wants the duplicate fix before renewal.")).toBeInTheDocument();

    await u.click(screen.getByRole("tab", { name: "Timeline" }));
    const timeline = await screen.findByRole("list", { name: "Customer timeline" });
    expect(within(timeline).getByText("Karthik wants the duplicate fix before renewal.")).toBeInTheDocument();
  });

  it("explains account health with the backend's own reasons", async () => {
    mockApi(opsRoutes({
      "GET /api/customers/1": { status: 200, body: sundaram },
      "GET /api/customers/1/interactions": { status: 200, body: page([{ id: 9, customer_id: 1, order_id: null, interaction_type: "renewal",
        sentiment: "negative", summary: "Renewal call", created_by_name: "Rohan Kulkarni", created_at: "2026-10-21T13:31:44Z" }]) },
      "GET /api/customers/1/timeline": { status: 200, body: { customer_id: 1, ...page([]) } },
    }));
    renderApp("/ops/customers/1");
    const health = await screen.findByRole("region", { name: "Account health" });
    expect(within(health).getAllByText("At risk")).toHaveLength(2); // the badge, and the status on the account
    expect(within(health).getByText(/5 negative interactions in the last 90 days/)).toBeInTheDocument();
    expect(within(health).getByText("5 in total")).toBeInTheDocument();
    expect(within(health).getByText(/At-risk rule used by the back office: status at_risk, or at least 2 negative interactions/)).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("links each number to the matching filtered list", async () => {
    mockApi(opsRoutes());
    renderApp("/ops");
    const link = async (name: RegExp) => (await screen.findByRole("link", { name })).getAttribute("href");
    expect(await link(/^Orders: 26/)).toBe("/ops/orders");
    expect(await link(/^Unresolved issues: 5/)).toBe("/ops/issues");
    expect(await link(/^Open issues: 2/)).toBe("/ops/issues?status=open");
    expect(await link(/^Offline-synced orders: 8/)).toBe("/ops/orders?client_network=offline_sync");
    expect(await link(/^Shipped: 2$/)).toBe("/ops/orders?status=shipped");
    expect(await link(/^High: 2$/)).toBe("/ops/issues?severity=high");
    expect((await screen.findByText("Duplicates")).closest("a")).toHaveAttribute("href", "/ops/issues?status=all&category=duplicate_order");
    const atRisk = await screen.findByText("5 negative interactions in the last 90 days", { exact: false });
    expect(atRisk.closest("a")).toHaveAttribute("href", "/ops/customers/1");
  });
});

describe("guards", () => {
  it("sends a customer opening /ops/customers/1 to /shop", async () => {
    mockApi(customerRoutes());
    renderApp("/ops/customers/1");
    await waitFor(() => expect(location()).toBe("/shop"));
  });
});
