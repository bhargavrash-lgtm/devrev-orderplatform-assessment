import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Message } from "../api";
import {
  callsTo, customerRoutes, makeOrder, mockApi, page, renderApp, sprayer, urea, type Handler,
} from "./utils";

const user = () => userEvent.setup();
const location = () => screen.getByTestId("location").textContent;

async function addToCart(name: string, times = 1) {
  const u = user();
  const button = await screen.findByRole("button", { name: `Add ${name} to cart` });
  for (let i = 0; i < times; i += 1) await u.click(button);
}

async function openCart() {
  await user().click(screen.getByRole("button", { name: /^Cart, / }));
  return screen.findByRole("dialog", { name: "Your cart" });
}

describe("cart", () => {
  it("updates the count and subtotal when items are added, changed and removed", async () => {
    mockApi(customerRoutes());
    renderApp("/shop");
    expect(await screen.findByRole("button", { name: "Cart, 0 items" })).toBeInTheDocument();

    await addToCart(urea.name, 2);
    await addToCart(sprayer.name);
    expect(screen.getByRole("button", { name: "Cart, 3 items" })).toBeInTheDocument();
    expect(await screen.findAllByText("Added to cart")).not.toHaveLength(0);

    const cart = await openCart();
    const subtotal = () => within(cart).getByTestId("cart-subtotal").textContent?.replace(/\s/g, "");
    expect(subtotal()).toBe("₹3,734"); // 2 × 267 + 3,200

    await user().click(within(cart).getByRole("button", { name: `Increase quantity of ${urea.name}` }));
    expect(subtotal()).toBe("₹4,001");
    expect(screen.getByRole("button", { name: "Cart, 4 items" })).toBeInTheDocument();

    // The sprayer has only 3 in stock: the stepper stops there.
    const increaseSprayer = within(cart).getByRole("button", { name: `Increase quantity of ${sprayer.name}` });
    await user().click(increaseSprayer);
    await user().click(increaseSprayer);
    expect(increaseSprayer).toBeDisabled();
    expect(within(cart).getByRole("spinbutton", { name: `Quantity of ${sprayer.name}` })).toHaveValue(3);

    await user().click(within(cart).getByRole("button", { name: `Remove ${sprayer.name}` }));
    expect(subtotal()).toBe("₹801");
    expect(screen.getByRole("button", { name: "Cart, 3 items" })).toBeInTheDocument();

    await user().click(within(cart).getByRole("button", { name: `Remove ${urea.name}` }));
    expect(within(cart).getByText("Your cart is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cart, 0 items" })).toBeInTheDocument();
  });
});

describe("checkout", () => {
  async function goToCheckout() {
    const cart = await openCart();
    await user().click(within(cart).getByRole("link", { name: "Proceed to checkout" }));
    await waitFor(() => expect(location()).toBe("/checkout"));
    return screen.findByRole("button", { name: /Place order|Try again/ });
  }

  it("sends one request per click, retries with the same key, and uses a new key for the next order", async () => {
    let attempts = 0;
    let release: () => void = () => undefined;
    const createOrder: Handler = async (init) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch"); // network failure
      if (attempts === 2) await new Promise<void>((resolve) => { release = resolve; }); // slow, still in flight
      const body = JSON.parse(String(init?.body));
      return { status: 201, body: makeOrder({ id: 40 + attempts, total: 267 * body.items[0].quantity }) };
    };
    const fetchMock = mockApi(customerRoutes({ "POST /api/orders": createOrder }));
    renderApp("/shop");
    await addToCart(urea.name, 2);
    let button = await goToCheckout();

    // 1st attempt fails with a network error.
    await user().click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");

    // Retry: a double click while the request is in flight sends exactly one request.
    button = screen.getByRole("button", { name: "Try again" });
    await user().dblClick(button);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/api/orders")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Placing order" })).toBeDisabled();
    release();
    expect(await screen.findByRole("heading", { name: "Order #42 is placed" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/api/orders")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cart, 0 items" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View order #42" })).toHaveAttribute("href", "/orders/42");

    const keys = callsTo(fetchMock, "POST", "/api/orders").map(({ init }) => new Headers(init?.headers).get("Idempotency-Key"));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]); // the retry reused the key

    // The body carried the cart, the default address and the chosen connection.
    const sent = JSON.parse(String(callsTo(fetchMock, "POST", "/api/orders")[1]!.init?.body));
    expect(sent).toEqual({ items: [{ product_id: urea.id, quantity: 2 }], delivery_note: null, address_id: 1, client_network: "good" });

    // A new order after success gets a new key.
    await user().click(screen.getByRole("link", { name: "Continue shopping" }));
    await addToCart(urea.name);
    await user().click(await goToCheckout());
    expect(await screen.findByRole("heading", { name: "Order #43 is placed" })).toBeInTheDocument();
    const third = new Headers(callsTo(fetchMock, "POST", "/api/orders")[2]!.init?.headers).get("Idempotency-Key");
    expect(third).toMatch(/^[0-9a-f-]{36}$/);
    expect(third).not.toBe(keys[0]);
  });

  it("sends the chosen address, note and connection", async () => {
    const fetchMock = mockApi(customerRoutes({ "POST /api/orders": { status: 201, body: makeOrder({ id: 50 }) } }));
    renderApp("/shop");
    await addToCart(urea.name);
    await goToCheckout();
    const u = user();
    await u.click(screen.getByRole("radio", { name: /Hosakote field office/ }));
    await u.type(screen.getByLabelText("Delivery note (optional)"), "Call Venkatesh at the gate");
    await u.selectOptions(screen.getByLabelText("Connection when ordering"), "offline_sync");
    await u.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByRole("heading", { name: "Order #50 is placed" });
    expect(JSON.parse(String(callsTo(fetchMock, "POST", "/api/orders")[0]!.init?.body))).toMatchObject({
      address_id: 2, delivery_note: "Call Venkatesh at the gate", client_network: "offline_sync",
    });
  });

  it("shows the API's error, e.g. not enough stock", async () => {
    mockApi(customerRoutes({
      "POST /api/orders": { status: 422, body: { error: "Not enough stock for EQ-BSP-16 (requested 3, in stock 2)" } },
    }));
    renderApp("/shop");
    await addToCart(sprayer.name, 3);
    await user().click(await goToCheckout());
    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough stock for EQ-BSP-16 (requested 3, in stock 2)");
  });
});

describe("my orders", () => {
  it("sends the filters to the orders API", async () => {
    const fetchMock = mockApi(customerRoutes({
      "GET /api/orders": { status: 200, body: page([makeOrder({ id: 23 }), makeOrder({ id: 22, order_status: "shipped" })]) },
    }));
    renderApp("/orders");
    expect(await screen.findByRole("cell", { name: "#23" })).toBeInTheDocument();
    const u = user();
    const lastQuery = () => callsTo(fetchMock, "GET", "/api/orders").at(-1)!.url.searchParams;

    await u.selectOptions(screen.getByLabelText("Status"), "shipped");
    await waitFor(() => expect(lastQuery().get("status")).toBe("shipped"));

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
    await waitFor(() => {
      expect(lastQuery().get("from")).toBe("2026-09-01");
      expect(lastQuery().get("to")).toBe("2026-10-31");
    });

    await u.type(screen.getByLabelText("Order number"), "23");
    await waitFor(() => expect(lastQuery().get("id")).toBe("23"));
    expect(Object.fromEntries(lastQuery())).toEqual({
      status: "shipped", from: "2026-09-01", to: "2026-10-31", id: "23", page: "1", page_size: "20",
    });
  });

  it("shows an empty state with a link to the shop", async () => {
    mockApi(customerRoutes());
    renderApp("/orders");
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the shop" })).toHaveAttribute("href", "/shop");
  });
});

describe("order detail", () => {
  it("shows the not-found page for an order the API won't show (404)", async () => {
    mockApi(customerRoutes({ "GET /api/orders/999": { status: 404, body: { error: "Order not found" } } }));
    renderApp("/orders/999");
    expect(await screen.findByRole("heading", { name: "We couldn't find that page" })).toBeInTheDocument();
  });

  function threadRoutes(initial: Message[]) {
    const messages = [...initial];
    return {
      messages,
      routes: {
        "GET /api/orders/5": { status: 200, body: makeOrder() },
        "GET /api/orders/5/messages": () => ({ status: 200, body: { items: messages, page: 1, page_size: 100, total: messages.length } }),
        "POST /api/orders/5/messages": (init: RequestInit | undefined) => {
          const message: Message = { id: messages.length + 1, order_id: 5, author_name: "Karthik Sundaram", author_role: "customer",
            body: JSON.parse(String(init?.body)).body, created_at: "2026-10-21T09:00:00Z" };
          messages.push(message);
          return { status: 201, body: message };
        },
      } satisfies Record<string, Handler>,
    };
  }

  it("sends a message with Ctrl+Enter and refreshes the thread", async () => {
    const { routes } = threadRoutes([{ id: 1, order_id: 5, author_name: "Meera Iyer", author_role: "ops",
      body: "Your order is confirmed.", created_at: "2026-10-20T11:00:00Z" }]);
    const fetchMock = mockApi(customerRoutes(routes));
    renderApp("/orders/5");
    expect(await screen.findByText("Your order is confirmed.")).toBeInTheDocument();
    expect(screen.getByText(/OrderWave support · Meera Iyer/)).toBeInTheDocument();

    await user().type(screen.getByLabelText("Write a message"), "When will it ship?{Control>}{Enter}{/Control}");
    expect(await screen.findByText("When will it ship?")).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, "POST", "/api/orders/5/messages")[0]!.init?.body))).toEqual({ body: "When will it ship?" });
    expect(callsTo(fetchMock, "GET", "/api/orders/5/messages").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Write a message")).toHaveValue("");
  });

  it("shows HTML in a message as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { routes } = threadRoutes([{ id: 1, order_id: 5, author_name: "Meera Iyer", author_role: "ops", body: evil,
      created_at: "2026-10-20T11:00:00Z" }]);
    const { container } = (mockApi(customerRoutes(routes)), renderApp("/orders/5"));
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("validates and reports an issue, then refreshes the list", async () => {
    const issues: unknown[] = [];
    const fetchMock = mockApi(customerRoutes({
      "GET /api/orders/5": { status: 200, body: makeOrder() },
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
      "GET /api/orders/5/issues": () => ({ status: 200, body: { items: issues } }),
      "POST /api/orders/5/issues": (init) => {
        const body = JSON.parse(String(init?.body));
        const issue = { id: 13, order_id: 5, customer: { id: 1, name: "Sundaram Agro Distributors" }, status: "open", jira_key: null,
          reported_by_name: "Karthik Sundaram", created_at: "2026-10-21T09:00:00Z", products: [], ...body };
        issues.push(issue);
        return { status: 201, body: issue };
      },
    }));
    renderApp("/orders/5?tab=issues");
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Report an issue" }));
    const dialog = screen.getByRole("dialog", { name: "Report an issue" });
    await u.click(within(dialog).getByRole("button", { name: "Report issue" }));
    expect(within(dialog).getByText("Choose what kind of problem this is.")).toBeInTheDocument();
    expect(within(dialog).getByText("Describe the problem in at least 5 characters.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/api/orders/5/issues")).toHaveLength(0);

    await u.selectOptions(within(dialog).getByLabelText("What went wrong?"), "damaged");
    await u.selectOptions(within(dialog).getByLabelText("How serious is it?"), "high");
    await u.type(within(dialog).getByLabelText("Description"), "Three bags split open.");
    await u.click(within(dialog).getByRole("button", { name: "Report issue" }));

    expect(await screen.findByText("Three bags split open.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(String(callsTo(fetchMock, "POST", "/api/orders/5/issues")[0]!.init?.body)))
      .toEqual({ category: "damaged", severity: "high", description: "Three bags split open." });
  });

  it("uploads a file, refreshes the list, and checks files before sending", async () => {
    const files: unknown[] = [];
    const fetchMock = mockApi(customerRoutes({
      "GET /api/orders/5": { status: 200, body: makeOrder() },
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
      "GET /api/orders/5/issues": { status: 200, body: { items: [] } },
      "GET /api/orders/5/attachments": () => ({ status: 200, body: { items: files } }),
      "POST /api/orders/5/attachments": (init) => {
        const file = (init?.body as FormData).get("file") as File;
        const attachment = { id: 1, order_id: 5, issue_id: null, filename: file.name, content_type: "image/png",
          size_bytes: file.size, uploaded_by_name: "Karthik Sundaram", created_at: "2026-10-21T09:00:00Z" };
        files.push(attachment);
        return { status: 201, body: attachment };
      },
    }));
    renderApp("/orders/5?tab=attachments");
    const input = await screen.findByLabelText("Attach a file");

    await userEvent.setup({ applyAccept: false }).upload(input, new File(["MZ"], "setup.exe", { type: "application/octet-stream" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only PNG, JPG, PDF and text (.txt) files can be attached.");
    expect(callsTo(fetchMock, "POST", "/api/orders/5/attachments")).toHaveLength(0);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "torn-bag.png", { type: "image/png" });
    await user().upload(input, png);
    const list = await screen.findByRole("list", { name: "Attached files" });
    expect(within(list).getByText("torn-bag.png")).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/api/orders/5/attachments")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Download torn-bag.png" })).toHaveAttribute("href", "/api/attachments/1");
  });

  it("shows the server's reason when an upload is rejected", async () => {
    mockApi(customerRoutes({
      "GET /api/orders/5": { status: 200, body: makeOrder() },
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
      "GET /api/orders/5/issues": { status: 200, body: { items: [] } },
      "GET /api/orders/5/attachments": { status: 200, body: { items: [] } },
      "POST /api/orders/5/attachments": { status: 422, body: { error: "Only PNG, JPG, PDF and UTF-8 text files are allowed, and the file extension must match the content" } },
    }));
    renderApp("/orders/5?tab=attachments");
    await user().upload(await screen.findByLabelText("Attach a file"), new File(["<html>"], "page.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the file extension must match the content");
  });

  it("submits feedback on a delivered order and then shows it", async () => {
    let feedback: unknown = null;
    const delivered = () => makeOrder({ order_status: "delivered", has_feedback: feedback !== null,
      events: ["placed", "confirmed", "packed", "shipped", "delivered"].map((s, i) => ({
        from_status: i ? (["placed", "confirmed", "packed", "shipped"][i - 1] as never) : null, to_status: s as never,
        changed_by_name: "Meera Iyer", created_at: `2026-10-2${i}T10:00:00Z` })) });
    const fetchMock = mockApi(customerRoutes({
      "GET /api/orders/5": () => ({ status: 200, body: delivered() }),
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
      "GET /api/orders/5/feedback": () => (feedback ? { status: 200, body: feedback } : { status: 404, body: { error: "Feedback not found" } }),
      "POST /api/orders/5/feedback": (init) => {
        feedback = { order_id: 5, created_at: "2026-10-26T10:00:00Z", ...JSON.parse(String(init?.body)) };
        return { status: 201, body: feedback };
      },
    }));
    renderApp("/orders/5?tab=feedback");
    const u = user();
    await u.click(await screen.findByRole("radio", { name: "4 stars" }));
    await u.type(screen.getByLabelText("Comment (optional)"), "On time, well packed.");
    await u.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(await screen.findByText("Your feedback")).toBeInTheDocument();
    expect(screen.getByText("On time, well packed.")).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, "POST", "/api/orders/5/feedback")[0]!.init?.body)))
      .toEqual({ rating: 4, comment: "On time, well packed." });
  });

  it("explains that feedback opens after delivery", async () => {
    mockApi(customerRoutes({
      "GET /api/orders/5": { status: 200, body: makeOrder({ order_status: "shipped" }) },
      "GET /api/orders/5/messages": { status: 200, body: page([]) },
    }));
    renderApp("/orders/5?tab=feedback");
    expect(await screen.findByText("Feedback opens after delivery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});
