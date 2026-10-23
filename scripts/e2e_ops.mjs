// End-to-end check of the ops back office against the running app, through the Vite dev server
// (so it also exercises the /api proxy). Uses Node's built-in fetch; no extra tools.
//
// Usage (backend on 8000 and `npm run dev` on 5173, passwords in the environment):
//   node scripts/e2e_ops.mjs [base_url]      default http://localhost:5173
//
// Reads SEED_OPS_PASSWORD and SEED_CUSTOMER_PASSWORD from the environment and never prints them.
// It changes real demo data: one order moves a step, and it adds a message, an issue update and
// an interaction.

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const OPS_PASSWORD = process.env.SEED_OPS_PASSWORD;
const CUSTOMER_PASSWORD = process.env.SEED_CUSTOMER_PASSWORD;
if (!OPS_PASSWORD || !CUSTOMER_PASSWORD) {
  console.error("Set SEED_OPS_PASSWORD and SEED_CUSTOMER_PASSWORD in the environment first.");
  process.exit(2);
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

class Session {
  cookie = "";
  async call(method, path, json) {
    const response = await fetch(BASE + path, {
      method,
      headers: { Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json() };
  }
  async login(email, password) {
    const r = await this.call("POST", "/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

const ops = new Session();
const me = await ops.login("ops@orderwave.demo", OPS_PASSWORD);
check("signed in as the ops demo user", me.role === "ops", `${me.full_name}, role ${me.role}`);

// 1. Orders with a customer filter.
const filtered = (await ops.call("GET", "/api/orders?customer=Sundaram&page_size=100")).body;
const names = [...new Set(filtered.items.map((o) => o.customer.name))];
check("orders filtered by customer", filtered.total > 0 && names.length === 1 && names[0] === "Sundaram Agro Distributors",
  `customer=Sundaram → ${filtered.total} orders, customers: ${names.join(", ")}`);

// 2. Change an order's status (the oldest order still waiting to be confirmed).
const placed = (await ops.call("GET", "/api/orders?status=placed&sort=created_at&page_size=1")).body.items[0];
if (!placed) {
  check("an order waiting in 'placed' exists", false, "none left; reseed the demo data");
} else {
  const changed = await ops.call("PUT", `/api/orders/${placed.id}`, { order_status: "confirmed" });
  const last = changed.body.events?.at(-1);
  check("order status changed", changed.status === 200 && changed.body.order_status === "confirmed",
    `#${placed.id} ${placed.customer.name}: placed → ${changed.body.order_status}, event by ${last?.changed_by_name}`);
  const skip = await ops.call("PUT", `/api/orders/${placed.id}`, { order_status: "delivered" });
  check("skipping a step is refused", skip.status === 422, skip.body.error);

  // 3. Reply on that order as the ops team.
  const reply = await ops.call("POST", `/api/orders/${placed.id}/messages`, { body: "Confirmed and booked on tomorrow's truck." });
  check("replied to the customer on the order", reply.status === 201 && reply.body.author_role === "ops",
    `message #${reply.body.id} by ${reply.body.author_name} (${reply.body.author_role})`);
}

// 4. Update an issue's status and Jira key.
const open = (await ops.call("GET", "/api/issues?status=open&sort=created_at&page_size=1")).body.items[0]
  ?? (await ops.call("GET", "/api/issues?status=all&page_size=1")).body.items[0];
const badKey = await ops.call("PUT", `/api/issues/${open.id}`, { jira_key: "scrum 31" });
check("a badly formatted Jira key is refused", badKey.status === 422, badKey.body.error);
const updated = await ops.call("PUT", `/api/issues/${open.id}`, { status: "investigating", jira_key: "SCRUM-31" });
check("issue status and Jira key updated", updated.status === 200 && updated.body.status === "investigating" && updated.body.jira_key === "SCRUM-31",
  `issue #${open.id} (${open.category}, ${open.customer.name}): ${open.status} → ${updated.body.status}, jira ${open.jira_key ?? "none"} → ${updated.body.jira_key}`);
const linked = (await ops.call("GET", "/api/issues?jira_key=SCRUM-31&status=all")).body;
check("the issue list finds it by Jira key", linked.items.some((i) => i.id === open.id), `jira_key=SCRUM-31 → ${linked.total} issue(s)`);

// 5. Add an interaction for Sundaram Agro and find it in the timeline.
const sundaram = (await ops.call("GET", "/api/customers?name=Sundaram")).body.items[0];
const summary = `E2E ${new Date().toISOString()}: walked Karthik through the duplicate-order fix plan.`;
const added = await ops.call("POST", `/api/customers/${sundaram.id}/interactions`,
  { interaction_type: "call", sentiment: "neutral", summary });
check("interaction added for Sundaram Agro", added.status === 201, `interaction #${added.body.id}, ${added.body.interaction_type}/${added.body.sentiment} by ${added.body.created_by_name}`);
const timeline = (await ops.call("GET", `/api/customers/${sundaram.id}/timeline?event_types=call&page_size=5`)).body;
check("it appears in Sundaram's timeline", timeline.items[0]?.summary === summary, `newest call event: ${timeline.items[0]?.event_at}`);

// 6. A customer can't reach the ops endpoints.
const customer = new Session();
await customer.login("sundaram@orderwave.demo", CUSTOMER_PASSWORD);
const asCustomer = await customer.call("GET", "/api/customers");
check("a customer login gets 403 on /api/customers", asCustomer.status === 403, `${asCustomer.status} ${JSON.stringify(asCustomer.body)}`);
const noSession = await new Session().call("GET", "/api/customers");
check("no session gets 401 on /api/customers", noSession.status === 401, `${noSession.status} ${JSON.stringify(noSession.body)}`);
check("a customer gets 403 on /api/insights", (await customer.call("GET", "/api/insights")).status === 403);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
