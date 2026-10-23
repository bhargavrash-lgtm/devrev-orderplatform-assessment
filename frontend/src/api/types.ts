/**
 * Response and request types, matching the backend's JSON (checked against the running API).
 * Timestamps are ISO 8601 strings in UTC ("2026-10-20T13:38:44Z"); plain dates are "YYYY-MM-DD".
 * Money is a number in INR.
 */

export type Role = "customer" | "ops";
export type OrderStatus = "placed" | "confirmed" | "packed" | "shipped" | "delivered" | "cancelled";
export type ClientNetwork = "good" | "weak" | "offline_sync";
export type IssueCategory = "delay" | "wrong_item" | "damaged" | "duplicate_order" | "billing" | "other";
export type IssueSeverity = "low" | "medium" | "high";
export type IssueStatus = "open" | "investigating" | "resolved";
export type IssueStatusFilter = IssueStatus | "unresolved" | "all";
export type Tier = "enterprise" | "mid_market" | "small";
export type CustomerStatus = "active" | "at_risk" | "churned";
export type InteractionType = "call" | "email" | "meeting" | "note" | "escalation" | "renewal";
export type Sentiment = "positive" | "neutral" | "negative";
export type TimelineEventType = "order" | "issue" | "message" | "feedback" | InteractionType;

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

// --- auth ---
export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  customer_id: number | null; // null for ops users
}

// --- products ---
export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  unit_price: number;
  stock: number;
  image_url: string | null;
}

// --- orders ---
export interface OrderItem {
  product_id: number;
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface OrderSummary {
  id: number;
  customer: { id: number; name: string };
  order_status: OrderStatus;
  client_network: ClientNetwork;
  total: number;
  delivery_note: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  items: OrderItem[];
}

export interface OrderAddress {
  label: string;
  line1: string;
  city: string;
  state: string | null;
  pincode: string | null;
}

export interface OrderEvent {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by_name: string;
  created_at: string;
}

export interface Order extends OrderSummary {
  address: OrderAddress | null;
  events: OrderEvent[];
  counts: { messages: number; issues: number; attachments: number };
  has_feedback: boolean;
}

export interface OrderCreate {
  items: Array<{ product_id: number; quantity: number }>;
  delivery_note?: string | null;
  address_id?: number | null;
  client_network?: ClientNetwork;
  customer_id?: number | null; // ops only
}

// --- messages ---
export interface Message {
  id: number;
  order_id: number;
  author_name: string;
  author_role: Role;
  body: string;
  created_at: string;
}

// --- issues ---
export interface Issue {
  id: number;
  order_id: number;
  customer: { id: number; name: string };
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  description: string;
  jira_key: string | null;
  reported_by_name: string;
  created_at: string;
  products: Array<{ product_id: number; sku: string; name: string }>;
}

export interface IssuePage extends Page<Issue> {
  status_filter: IssueStatusFilter;
}

export interface IssueCreate {
  category: IssueCategory;
  severity?: IssueSeverity;
  description: string;
  jira_key?: string | null; // ops only
}

export interface IssueUpdate {
  status?: IssueStatus;
  severity?: IssueSeverity;
  category?: IssueCategory;
  jira_key?: string | null;
}

// --- feedback and reviews ---
export interface Feedback {
  order_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface Review {
  id: number;
  product_id: number;
  order_id: number | null;
  customer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface ReviewPage extends Page<Review> {
  product_id: number;
  average_rating: number | null;
  review_count: number;
}

// --- attachments ---
export interface Attachment {
  id: number;
  order_id: number;
  issue_id: number | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: string;
}

// --- customers ---
export interface CustomerAddress {
  id: number;
  label: string;
  line1: string;
  city: string;
  state: string | null;
  pincode: string | null;
  is_default: boolean;
}

/** GET /api/customer: what a customer user may see about their own company. */
export interface OwnCustomer {
  id: number;
  customer_code: string;
  name: string;
  city: string | null;
  state: string | null;
  addresses: CustomerAddress[];
  contacts: Array<{ full_name: string; title: string | null; is_primary: boolean }>;
}

export interface CustomerSummary {
  order_count: number;
  lifetime_value: number;
  last_order_at: string | null;
  unresolved_issues: number;
  open_issues_only: number;
  investigating_issues: number;
  total_issues: number;
  avg_rating: number | null;
  negative_interactions: number;
  last_interaction_at: string | null;
}

export interface CustomerRecord {
  id: number;
  customer_code: string;
  name: string;
  industry: string | null;
  tier: Tier;
  region: string | null;
  city: string | null;
  state: string | null;
  account_owner: { id: number; name: string } | null;
  annual_contract_value: number | null;
  currency: "INR";
  renewal_date: string | null;
  status: CustomerStatus;
  customer_since: string | null;
  contact_email: string | null;
  summary: CustomerSummary;
}

export interface CustomerContact {
  id: number;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

export interface CustomerDetail extends CustomerRecord {
  contacts: CustomerContact[];
  addresses: CustomerAddress[];
}

export interface TimelineEvent {
  event_type: TimelineEventType;
  event_at: string;
  order_id: number | null;
  summary: string;
}

export interface TimelinePage extends Page<TimelineEvent> {
  customer_id: number;
}

export interface Interaction {
  id: number;
  customer_id: number;
  order_id: number | null;
  interaction_type: InteractionType;
  sentiment: Sentiment;
  summary: string;
  created_by_name: string;
  created_at: string;
}

export interface InteractionCreate {
  interaction_type: InteractionType;
  summary: string;
  sentiment?: Sentiment;
  order_id?: number | null;
}

// --- insights ---
export interface Insights {
  orders_by_status: Partial<Record<OrderStatus, number>>;
  orders_by_client_network: Partial<Record<ClientNetwork, number>>;
  unresolved_issues_by_category: Partial<Record<IssueCategory, number>>;
  unresolved_issues_by_severity: Partial<Record<IssueSeverity, number>>;
  issues_by_status: Partial<Record<IssueStatus, number>>;
  feedback: {
    average_rating: number | null;
    count: number;
    ratings_distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  };
  top_customers_by_unresolved_issues: Array<{
    customer_id: number;
    name: string;
    unresolved_issues: number;
    open_issues_only: number;
    investigating_issues: number;
  }>;
  recurring_issues_by_category: Array<{
    category: IssueCategory;
    issue_count: number;
    unresolved: number;
    resolved: number;
    customers_affected: string[];
  }>;
  recent_events: Array<{
    customer_id: number;
    customer_name: string;
    event_type: TimelineEventType;
    event_at: string;
    order_id: number | null;
    summary: string;
  }>;
  customers_at_risk: Array<{
    customer_id: number;
    customer_code: string;
    name: string;
    renewal_date: string | null;
    unresolved_issues: number;
    reasons: string[];
  }>;
  notes: Record<string, string>;
}
