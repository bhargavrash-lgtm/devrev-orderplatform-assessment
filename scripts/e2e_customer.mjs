// End-to-end check of the customer flow against the running app, through the Vite dev server
// (so it also exercises the /api proxy). Uses Node's built-in fetch; no extra tools.
//
// Usage (backend on 8000 and `npm run dev` on 5173, passwords in the environment):
//   node scripts/e2e_customer.mjs [base_url]      default http://localhost:5173
//
// Reads SEED_CUSTOMER_PASSWORD from the environment and never prints it. This creates one real
// order, message, issue and attachment for the Sundaram demo customer.

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const PASSWORD = process.env.SEED_CUSTOMER_PASSWORD;
if (!PASSWORD) {
  console.error("Set SEED_CUSTOMER_PASSWORD in the environment first.");
  process.exit(2);
}

// A real 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

class Session {
  cookie = "";
  async call(method, path, { json, form, headers = {} } = {}) {
    const response = await fetch(BASE + path, {
      method,
      headers: { Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: json ? JSON.stringify(json) : form,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body, headers: response.headers };
  }
  async login(email) {
    const r = await this.call("POST", "/api/auth/login", { json: { email, password: PASSWORD } });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

const home = await fetch(BASE + "/");
check("frontend serves the app", home.status === 200 && (await home.text()).includes("<title>OrderWave</title>"), BASE);

const sundaram = new Session();
const me = await sundaram.login("sundaram@orderwave.demo");
check("signed in as Sundaram demo customer", me.role === "customer", `${me.full_name}, customer_id ${me.customer_id}`);

// 1. Same Idempotency-Key twice -> one order.
const product = (await sundaram.call("GET", "/api/products?q=FT-UREA-45")).body.items[0];
const before = (await sundaram.call("GET", "/api/orders?page_size=1")).body.total;
const key = crypto.randomUUID();
const order = { items: [{ product_id: product.id, quantity: 2 }], delivery_note: "E2E check", client_network: "weak" };
const first = await sundaram.call("POST", "/api/orders", { json: order, headers: { "Idempotency-Key": key } });
const second = await sundaram.call("POST", "/api/orders", { json: order, headers: { "Idempotency-Key": key } });
const after = (await sundaram.call("GET", "/api/orders?page_size=1")).body.total;
const orderId = first.body.id;
check("first POST /api/orders creates the order", first.status === 201, `201 → order #${orderId}, total ₹${first.body.total}`);
check("second POST with the same key returns the same order", second.status === 200 && second.body.id === orderId,
  `${second.status} → order #${second.body.id}`);
check("only one order exists for that key", after === before + 1, `orders before ${before}, after ${after}`);
const byId = (await sundaram.call("GET", `/api/orders?id=${orderId}`)).body;
check("the order list shows it exactly once", byId.total === 1 && byId.items[0].id === orderId);

// 2. Message.
const message = await sundaram.call("POST", `/api/orders/${orderId}/messages`, { json: { body: "E2E: can this ship tomorrow? <b>not bold</b>" } });
const thread = (await sundaram.call("GET", `/api/orders/${orderId}/messages`)).body;
check("message sent and in the thread", message.status === 201 && thread.items.some((m) => m.id === message.body.id),
  `message #${message.body.id}, stored as "${message.body.body}"`);

// 3. Issue.
const issue = await sundaram.call("POST", `/api/orders/${orderId}/issues`,
  { json: { category: "damaged", severity: "medium", description: "E2E: two bags arrived torn." } });
const issues = (await sundaram.call("GET", `/api/orders/${orderId}/issues`)).body;
check("issue reported", issue.status === 201 && issues.items.some((i) => i.id === issue.body.id),
  `issue #${issue.body.id}, ${issue.body.category}/${issue.body.severity}/${issue.body.status}`);

// 4. Attachment (PNG) and download.
const form = new FormData();
form.append("file", new Blob([PNG], { type: "image/png" }), "e2e-check.png");
form.append("issue_id", String(issue.body.id));
const upload = await sundaram.call("POST", `/api/orders/${orderId}/attachments`, { form });
check("PNG uploaded", upload.status === 201, `attachment #${upload.body.id}, ${upload.body.content_type}, ${upload.body.size_bytes} bytes`);
const download = await sundaram.call("GET", `/api/attachments/${upload.body.id}`);
check("download returns the same bytes, as an attachment, with nosniff",
  download.status === 200 && Buffer.compare(download.body, PNG) === 0
    && download.headers.get("x-content-type-options") === "nosniff"
    && (download.headers.get("content-disposition") ?? "").startsWith("attachment"),
  download.headers.get("content-disposition") ?? "");

// 5. Another customer's order is the same 404 as a missing one.
const greenfield = new Session();
await greenfield.login("greenfield@orderwave.demo");
const otherId = (await greenfield.call("GET", "/api/orders?page_size=1")).body.items[0].id;
const other = await sundaram.call("GET", `/api/orders/${otherId}`);
const missing = await sundaram.call("GET", "/api/orders/999999");
check("Greenfield's order is hidden from Sundaram (404)", other.status === 404, `GET /api/orders/${otherId} → ${other.status} ${JSON.stringify(other.body)}`);
check("…identical to a missing order", missing.status === 404 && JSON.stringify(other.body) === JSON.stringify(missing.body),
  `GET /api/orders/999999 → ${missing.status} ${JSON.stringify(missing.body)}`);
check("…and its messages too", (await sundaram.call("GET", `/api/orders/${otherId}/messages`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
