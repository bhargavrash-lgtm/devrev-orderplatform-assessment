import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, orders, type Order, type OrderStatus } from "../../api";
import {
  Badge, Card, ErrorState, LoadingState, PlainText, SectionCard, Skeleton, Table, Tabs, Timeline, type TimelineStep,
} from "../../components/ui";
import { formatDateTime, formatInr, humanize } from "../../lib/format";
import { NotFoundContent } from "../NotFoundPage";
import { AttachmentsTab } from "./order/AttachmentsTab";
import { ConversationTab } from "./order/ConversationTab";
import { FeedbackTab } from "./order/FeedbackTab";
import { IssuesTab } from "./order/IssuesTab";

const FLOW: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered"];
const TABS = ["conversation", "issues", "attachments", "feedback"] as const;
type TabId = (typeof TABS)[number];

/** Steps from the order's status history: reached steps with their time, the rest still to come. */
export function orderSteps(order: Order): TimelineStep[] {
  const reachedAt = new Map(order.events.map((e) => [e.to_status, e.created_at]));
  if (order.order_status === "cancelled") {
    const reached = FLOW.filter((status) => reachedAt.has(status));
    return [
      ...reached.map((status) => ({ id: status, title: humanize(status), state: "done" as const, meta: formatDateTime(reachedAt.get(status)!) })),
      { id: "cancelled", title: "Cancelled", state: "cancelled", meta: reachedAt.has("cancelled") ? formatDateTime(reachedAt.get("cancelled")!) : undefined },
    ];
  }
  const currentIndex = FLOW.indexOf(order.order_status);
  return FLOW.map((status, index) => ({
    id: status,
    title: humanize(status),
    state: index < currentIndex || order.order_status === "delivered" ? "done" : index === currentIndex ? "current" : "upcoming",
    meta: reachedAt.has(status) ? formatDateTime(reachedAt.get(status)!) : index > currentIndex ? "Not yet" : undefined,
  }));
}

function DetailSkeleton() {
  return (
    <LoadingState label="Loading order" className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </LoadingState>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const valid = Number.isInteger(orderId) && orderId > 0;
  const [params, setParams] = useSearchParams();
  const tab: TabId = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as TabId) : "conversation";

  const query = useQuery({ queryKey: ["order", orderId], queryFn: () => orders.get(orderId), enabled: valid });

  // Missing and someone else's orders get the same 404 from the API, and the same page here.
  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <Card><NotFoundContent description="This order doesn't exist, or the link is wrong." /></Card>;
  }
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return <Card><ErrorState title="Couldn't load this order" message={query.error.message} onRetry={() => void query.refetch()} /></Card>;
  }
  const order = query.data;

  return (
    <>
      <Link to="/orders" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded text-sm text-ink-subtle hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My orders
      </Link>
      <div className="mb-section flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Order #{order.id}</h1>
            <Badge kind="status" value={order.order_status} />
          </div>
          <p className="mt-1.5 text-sm text-ink-subtle">
            Placed {formatDateTime(order.created_at)}
            {order.client_network !== "good" && ` · ordered on a ${order.client_network === "weak" ? "weak signal" : "connection that synced later"}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xs font-semibold uppercase text-ink-subtle">Total</p>
          <p className="text-2xl font-semibold tabular-nums text-ink">{formatInr(order.total)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title="Progress">
            <Timeline label="Order progress" steps={orderSteps(order)} />
          </SectionCard>
          <SectionCard title="Delivery">
            {order.address ? (
              <div className="flex gap-3 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                <address className="not-italic">
                  <span className="block font-medium text-ink">{order.address.label}</span>
                  <span className="block text-ink-muted">{order.address.line1}</span>
                  <span className="block text-ink-muted">{[order.address.city, order.address.state, order.address.pincode].filter(Boolean).join(", ")}</span>
                </address>
              </div>
            ) : <p className="text-sm text-ink-subtle">No delivery address on this order.</p>}
            {order.delivery_note && (
              <div className="mt-4 border-t border-line-soft pt-4">
                <p className="text-2xs font-semibold uppercase text-ink-subtle">Delivery note</p>
                <PlainText text={order.delivery_note} className="mt-1 text-sm text-ink" />
              </div>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-6">
          <SectionCard title="Items" description={`${order.item_count} ${order.item_count === 1 ? "product" : "products"}`} flush>
            <Table
              caption={`Items in order ${order.id}`}
              rowKey={(item) => item.product_id}
              rows={order.items}
              mobileTitle={(item) => item.name}
              columns={[
                { key: "name", header: "Product", hideOnMobile: true, cell: (item) => (
                  <span><span className="font-medium text-ink">{item.name}</span><span className="block font-mono text-xs text-ink-faint">{item.sku}</span></span>
                ) },
                { key: "qty", header: "Quantity", align: "right", cell: (item) => item.quantity },
                { key: "price", header: "Unit price", align: "right", cell: (item) => formatInr(item.unit_price) },
                { key: "total", header: "Line total", align: "right", cell: (item) => formatInr(item.quantity * item.unit_price) },
              ]}
            />
            <div className="flex justify-end gap-6 border-t border-line px-5 py-3 text-sm">
              <span className="text-ink-muted">Order total</span>
              <span className="font-semibold tabular-nums text-ink">{formatInr(order.total)}</span>
            </div>
          </SectionCard>

          <Card className="p-5">
            <Tabs
              label="Order activity"
              value={tab}
              onChange={(next) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", next); return n; }, { replace: true })}
              items={[
                { id: "conversation", label: "Conversation", count: order.counts.messages, content: <ConversationTab orderId={order.id} /> },
                { id: "issues", label: "Issues", count: order.counts.issues, content: <IssuesTab orderId={order.id} /> },
                { id: "attachments", label: "Attachments", count: order.counts.attachments, content: <AttachmentsTab orderId={order.id} /> },
                { id: "feedback", label: "Feedback", content: <FeedbackTab order={order} /> },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
