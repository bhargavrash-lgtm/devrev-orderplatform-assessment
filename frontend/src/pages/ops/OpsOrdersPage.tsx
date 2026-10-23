import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Package, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { orders, type ClientNetwork, type OrderStatus, type OrderSummary } from "../../api";
import { DebouncedFilter } from "../../components/DebouncedFilter";
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, Table, type Column,
} from "../../components/ui";
import { itemsSummary, networkLabel } from "../../features/order/OrderSections";
import { cn } from "../../lib/cn";
import { formatDateTime, formatInr, humanize } from "../../lib/format";
import { useUrlFilters } from "../../lib/useUrlFilters";

const PAGE_SIZE = 25;
const STATUSES: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
const NETWORKS: ClientNetwork[] = ["good", "weak", "offline_sync"];
// ORDER_SORTS in orders_api.py: created_at, total, id (prefix - for descending).
const SORTS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-total", label: "Highest total" },
  { value: "total", label: "Lowest total" },
  { value: "-id", label: "Order number, high to low" },
];
export const FILTER_KEYS = ["id", "customer", "product", "status", "client_network", "from", "to"] as const;

const columns: Column<OrderSummary>[] = [
  { key: "id", header: "Order", hideOnMobile: true,
    cell: (o) => <Link to={`/ops/orders/${o.id}`} className="focus-ring rounded font-medium text-accent-700 hover:underline">#{o.id}</Link> },
  { key: "customer", header: "Customer",
    cell: (o) => <Link to={`/ops/customers/${o.customer.id}`} className="focus-ring rounded text-ink hover:text-accent-700">{o.customer.name}</Link> },
  { key: "placed", header: "Placed", cell: (o) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(o.created_at)}</span> },
  { key: "items", header: "Items", cell: (o) => <span className="text-ink-muted">{itemsSummary(o)}</span> },
  { key: "network", header: "Connection",
    cell: (o) => o.client_network === "good"
      ? <span className="text-ink-subtle">Good</span>
      : <Badge tone={o.client_network === "offline_sync" ? "amber" : "neutral"}>{networkLabel(o.client_network)}</Badge> },
  { key: "total", header: "Total", align: "right", cell: (o) => formatInr(o.total) },
  { key: "status", header: "Status", cell: (o) => <Badge kind="status" value={o.order_status} /> },
];

export function OpsOrdersPage() {
  const filters = useUrlFilters();
  const query = {
    id: filters.get("id") ? Number(filters.get("id")) : undefined,
    customer: filters.get("customer") || undefined,
    product: filters.get("product") || undefined,
    status: filters.get("status") || undefined,
    client_network: filters.get("client_network") || undefined,
    from: filters.get("from") || undefined,
    to: filters.get("to") || undefined,
    sort: filters.get("sort", "-created_at"),
    page: filters.page,
    page_size: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ["orders", "ops", query], queryFn: () => orders.list(query), placeholderData: keepPreviousData });
  const filtered = FILTER_KEYS.some((key) => filters.get(key));

  return (
    <>
      <PageHeader title="Orders" description="Every customer order. Filters stay in the address bar, so you can share or reload a view." />
      <Card>
        <div className="grid gap-3 border-b border-line-soft p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 xl:items-end">
          <DebouncedFilter label="Order #" inputMode="numeric" value={filters.get("id")} placeholder="23"
            validate={(v) => (/^\d+$/.test(v) ? null : "Digits only")} onCommit={(v) => filters.set({ id: v })} />
          <div className="xl:col-span-2">
            <DebouncedFilter label="Customer" value={filters.get("customer")} placeholder="Name contains"
              leading={<Search className="h-4 w-4" aria-hidden="true" />} onCommit={(v) => filters.set({ customer: v })} />
          </div>
          <DebouncedFilter label="Product" value={filters.get("product")} placeholder="Name or SKU" onCommit={(v) => filters.set({ product: v })} />
          <Select label="Status" placeholder="Any status" value={filters.get("status")}
            options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} onChange={(e) => filters.set({ status: e.target.value })} />
          <Select label="Connection" placeholder="Any" value={filters.get("client_network")}
            options={NETWORKS.map((n) => ({ value: n, label: networkLabel(n) }))} onChange={(e) => filters.set({ client_network: e.target.value })} />
          <Input label="From" type="date" value={filters.get("from")} max={filters.get("to") || undefined} onChange={(e) => filters.set({ from: e.target.value })} />
          <Input label="To" type="date" value={filters.get("to")} min={filters.get("from") || undefined} onChange={(e) => filters.set({ to: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5">
          <p className="text-sm text-ink-subtle" aria-live="polite">
            {list.data ? `${list.data.total} ${list.data.total === 1 ? "order" : "orders"}` : " "}
          </p>
          <div className="flex items-center gap-2">
            <div className="w-56"><Select label="Sort" hideLabel options={SORTS} value={query.sort} onChange={(e) => filters.set({ sort: e.target.value })} /></div>
            <Button variant="ghost" size="sm" disabled={!filtered} onClick={() => filters.clear(["sort"])}>Clear filters</Button>
          </div>
        </div>

        {list.isPending ? (
          <SkeletonRows rows={8} label="Loading orders" />
        ) : list.isError ? (
          <ErrorState title="Couldn't load orders" message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<Package className="h-6 w-6" />} title={filtered ? "No orders match these filters" : "No orders yet"}
            description={filtered ? "Try a wider date range or fewer filters." : "Orders will appear here as customers place them."}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => filters.clear(["sort"])}>Clear filters</Button> : undefined} />
        ) : (
          <div className={cn(list.isFetching && "opacity-70 transition-opacity")}>
            <Table caption="Orders" columns={columns} rows={list.data.items} rowKey={(o) => o.id} compact stickyHeader
              mobileTitle={(o) => <Link to={`/ops/orders/${o.id}`} className="focus-ring rounded text-accent-700">Order #{o.id}</Link>} />
            <div className="border-t border-line-soft">
              <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.total} noun="orders"
                onPageChange={(p) => filters.set({ page: String(p) })} />
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
