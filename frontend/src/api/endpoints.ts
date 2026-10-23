import { request, type Query } from "./client";
import type {
  Attachment, CustomerDetail, CustomerRecord, Feedback, Insights, Interaction, InteractionCreate, Issue,
  IssueCreate, IssuePage, IssueStatusFilter, IssueUpdate, Message, Order, OrderCreate, OrderStatus, OrderSummary,
  OwnCustomer, Page, Product, ReviewPage, Review, TimelinePage, User,
} from "./types";

type Paging = { page?: number; page_size?: number };

// --- auth ---
export const auth = {
  /** 401 here means wrong email or password, not an expired session. */
  login: (email: string, password: string) =>
    request<User>("/api/auth/login", { method: "POST", json: { email, password }, allowUnauthorized: true }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", allowUnauthorized: true }),
  /** 401 here just means nobody is logged in yet. */
  me: () => request<User>("/api/auth/me", { allowUnauthorized: true }),
};

// --- products ---
export type ProductQuery = Paging & { q?: string; category?: string; in_stock?: boolean; sort?: string };

export const products = {
  list: (query: ProductQuery = {}) => request<Page<Product>>("/api/products", { query }),
  reviews: (productId: number, query: Paging = {}) =>
    request<ReviewPage>(`/api/products/${productId}/reviews`, { query }),
  addReview: (productId: number, body: { order_id: number; rating: number; comment?: string | null }) =>
    request<Review>(`/api/products/${productId}/reviews`, { method: "POST", json: body }),
};

// --- orders ---
export type OrderQuery = Paging & {
  id?: number;
  customer?: string;
  product?: string;
  status?: string; // one status or a comma-separated list
  client_network?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  sort?: string;
};

export const orders = {
  list: (query: OrderQuery = {}) => request<Page<OrderSummary>>("/api/orders", { query: query as Query }),
  get: (id: number) => request<Order>(`/api/orders/${id}`),
  /** Pass the same idempotencyKey when retrying, so a retry never creates a second order. */
  create: (body: OrderCreate, idempotencyKey?: string) =>
    request<Order>("/api/orders", {
      method: "POST",
      json: body,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
  setStatus: (id: number, orderStatus: OrderStatus) =>
    request<Order>(`/api/orders/${id}`, { method: "PUT", json: { order_status: orderStatus } }),

  messages: (id: number, query: Paging = {}) => request<Page<Message>>(`/api/orders/${id}/messages`, { query }),
  postMessage: (id: number, body: string) =>
    request<Message>(`/api/orders/${id}/messages`, { method: "POST", json: { body } }),

  issues: (id: number) => request<{ items: Issue[] }>(`/api/orders/${id}/issues`),
  reportIssue: (id: number, body: IssueCreate) =>
    request<Issue>(`/api/orders/${id}/issues`, { method: "POST", json: body }),

  feedback: (id: number) => request<Feedback>(`/api/orders/${id}/feedback`),
  leaveFeedback: (id: number, body: { rating: number; comment?: string | null }) =>
    request<Feedback>(`/api/orders/${id}/feedback`, { method: "POST", json: body }),

  attachments: (id: number) => request<{ items: Attachment[] }>(`/api/orders/${id}/attachments`),
  upload: (id: number, file: File, issueId?: number | null) => {
    const form = new FormData();
    form.append("file", file);
    if (issueId != null) form.append("issue_id", String(issueId));
    return request<Attachment>(`/api/orders/${id}/attachments`, { method: "POST", form });
  },
};

/** Downloads go through the API (with the access check), never a static path. */
export function attachmentUrl(attachmentId: number): string {
  return `/api/attachments/${attachmentId}`;
}

// --- issues ---
export type IssueQuery = Paging & {
  status?: IssueStatusFilter;
  category?: string;
  severity?: string;
  customer?: string;
  jira_key?: string;
  order_id?: number;
  sort?: string;
};

export const issues = {
  list: (query: IssueQuery = {}) => request<IssuePage>("/api/issues", { query: query as Query }),
  update: (id: number, body: IssueUpdate) => request<Issue>(`/api/issues/${id}`, { method: "PUT", json: body }),
};

// --- customers ---
export type CustomerQuery = Paging & {
  name?: string;
  tier?: string;
  status?: string;
  region?: string;
  account_owner?: string;
  sort?: string;
};

export type TimelineQuery = Paging & { event_types?: string; from?: string; to?: string };
export type InteractionQuery = Paging & { interaction_type?: string; sentiment?: string; from?: string; to?: string };

export const customers = {
  /** A customer user's own basic profile. */
  mine: () => request<OwnCustomer>("/api/customer"),
  list: (query: CustomerQuery = {}) => request<Page<CustomerRecord>>("/api/customers", { query }),
  get: (id: number) => request<CustomerDetail>(`/api/customers/${id}`),
  orders: (id: number, query: OrderQuery = {}) =>
    request<Page<OrderSummary>>(`/api/customers/${id}/orders`, { query: query as Query }),
  timeline: (id: number, query: TimelineQuery = {}) =>
    request<TimelinePage>(`/api/customers/${id}/timeline`, { query }),
  interactions: (id: number, query: InteractionQuery = {}) =>
    request<Page<Interaction>>(`/api/customers/${id}/interactions`, { query }),
  logInteraction: (id: number, body: InteractionCreate) =>
    request<Interaction>(`/api/customers/${id}/interactions`, { method: "POST", json: body }),
};

// --- insights ---
export const insights = {
  get: () => request<Insights>("/api/insights"),
};
