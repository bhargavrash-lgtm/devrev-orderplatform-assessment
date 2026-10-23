import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { customerUser, mockApi, NOT_LOGGED_IN, opsUser, ownCustomer, renderApp } from "./utils";

// Test-only value, never a real account password.
const TYPED_PASSWORD = "typed-in-test";

async function signIn(email: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), TYPED_PASSWORD);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

const location = () => screen.getByTestId("location").textContent;

describe("login", () => {
  it("sends a customer to /shop after signing in", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": NOT_LOGGED_IN,
      "POST /api/auth/login": { status: 200, body: customerUser },
      "GET /api/customer": { status: 200, body: ownCustomer },
    });
    renderApp("/login");
    await signIn(customerUser.email);
    await waitFor(() => expect(location()).toBe("/shop"));
    expect(await screen.findByRole("heading", { name: "Shop" })).toBeInTheDocument();

    const loginCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/auth/login");
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ email: customerUser.email, password: TYPED_PASSWORD });
    expect(loginCall?.[1]?.credentials).toBe("same-origin");
  });

  it("sends an ops user to /ops after signing in", async () => {
    mockApi({
      "GET /api/auth/me": NOT_LOGGED_IN,
      "POST /api/auth/login": { status: 200, body: opsUser },
    });
    renderApp("/login");
    await signIn(opsUser.email);
    await waitFor(() => expect(location()).toBe("/ops"));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
  });

  it("shows the API's error message for a wrong password and stays on /login", async () => {
    mockApi({
      "GET /api/auth/me": NOT_LOGGED_IN,
      "POST /api/auth/login": { status: 401, body: { error: "Invalid email or password" } },
    });
    renderApp("/login");
    await signIn(customerUser.email);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(location()).toBe("/login");
    expect(screen.getByLabelText("Password")).toHaveValue(TYPED_PASSWORD);
  });

  it("demo chips fill only the email, never the password", async () => {
    mockApi({ "GET /api/auth/me": NOT_LOGGED_IN });
    renderApp("/login");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ops@orderwave\.demo/ }));
    expect(screen.getByLabelText("Email")).toHaveValue("ops@orderwave.demo");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveFocus();
  });

  it("can show and hide the password", async () => {
    mockApi({ "GET /api/auth/me": NOT_LOGGED_IN });
    renderApp("/login");
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });
});

describe("route guards", () => {
  it("sends a logged-out visitor of /orders to /login", async () => {
    mockApi({ "GET /api/auth/me": NOT_LOGGED_IN });
    renderApp("/orders");
    await waitFor(() => expect(location()).toBe("/login"));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it.each(["/ops", "/ops/customers", "/ops/customers/1", "/ops/anything"])("sends a customer visiting %s to /shop", async (path) => {
    mockApi({
      "GET /api/auth/me": { status: 200, body: customerUser },
      "GET /api/customer": { status: 200, body: ownCustomer },
    });
    renderApp(path);
    await waitFor(() => expect(location()).toBe("/shop"));
  });

  it.each(["/shop", "/orders", "/orders/5"])("sends an ops user visiting %s to /ops", async (path) => {
    mockApi({ "GET /api/auth/me": { status: 200, body: opsUser } });
    renderApp(path);
    await waitFor(() => expect(location()).toBe("/ops"));
  });

  it("lets a customer open their own pages", async () => {
    mockApi({
      "GET /api/auth/me": { status: 200, body: customerUser },
      "GET /api/customer": { status: 200, body: ownCustomer },
    });
    renderApp("/orders/12");
    expect(await screen.findByRole("heading", { name: "Order #12" })).toBeInTheDocument();
    expect(location()).toBe("/orders/12");
  });

  it("shows the 404 page for unknown paths", async () => {
    mockApi({ "GET /api/auth/me": NOT_LOGGED_IN });
    renderApp("/no-such-page");
    expect(await screen.findByRole("heading", { name: "We couldn't find that page" })).toBeInTheDocument();
  });

  it("returns to /login when any API call answers 401", async () => {
    mockApi({
      "GET /api/auth/me": { status: 200, body: customerUser },
      // The session expired between loading the app and the next request.
      "GET /api/customer": { status: 401, body: { error: "Not authenticated" } },
    });
    renderApp("/shop");
    await waitFor(() => expect(location()).toBe("/login"));
    expect(await screen.findByText("Your session has ended")).toBeInTheDocument();
  });

  it("signs out from the customer menu", async () => {
    mockApi({
      "GET /api/auth/me": { status: 200, body: customerUser },
      "GET /api/customer": { status: 200, body: ownCustomer },
      "POST /api/auth/logout": { status: 200, body: { ok: true } },
    });
    renderApp("/shop");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(await screen.findByText("Sundaram Agro Distributors")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(location()).toBe("/login"));
  });
});
