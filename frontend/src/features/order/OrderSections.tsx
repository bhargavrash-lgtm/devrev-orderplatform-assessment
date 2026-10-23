import { MapPin } from "lucide-react";
import type { Order, OrderStatus, OrderSummary } from "../../api";
import { PlainText, SectionCard, Table, Timeline, type TimelineStep } from "../../components/ui";
import { formatDateTime, formatInr, humanize } from "../../lib/format";

const FLOW: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered"];

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

export function ProgressCard({ order, showActors = false }: { order: Order; showActors?: boolean }) {
  const steps = orderSteps(order);
  if (showActors) {
    const by = new Map(order.events.map((e) => [e.to_status, e.changed_by_name]));
    for (const step of steps) {
      const name = by.get(step.id as OrderStatus);
      if (name && step.meta) step.meta = `${step.meta} · ${name}`;
    }
  }
  return (
    <SectionCard title="Progress">
      <Timeline label="Order progress" steps={steps} />
    </SectionCard>
  );
}

export function DeliveryCard({ order }: { order: Order }) {
  return (
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
  );
}

export function ItemsCard({ order }: { order: Order }) {
  return (
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
  );
}

/** "Neem-Coated Urea (45 kg) × 10 + 2 more" */
export function itemsSummary(order: OrderSummary): string {
  const [first, ...rest] = order.items;
  if (!first) return "No items";
  const head = `${first.name} × ${first.quantity}`;
  return rest.length ? `${head} + ${rest.length} more` : head;
}

export function networkLabel(network: Order["client_network"]): string {
  return network === "weak" ? "Weak signal" : network === "offline_sync" ? "Offline, synced later" : "Good signal";
}
