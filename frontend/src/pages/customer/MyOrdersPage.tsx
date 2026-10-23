import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardList, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { orders, type OrderStatus, type OrderSummary } from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, Table, type Column,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDate, formatInr, humanize } from "../../lib/format";
import { useDebouncedValue } from "../../lib/hooks";
import { itemsSummary } from "../../features/order/OrderSections";

const PAGE_SIZE = 20;
const STATUSES: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];

const columns: Column<OrderSummary>[] = [
  {
    key: "id", header: "Order", hideOnMobile: true,
    cell: (o) => <Link to={`/orders/${o.id}`} className="focus-ring rounded font-medium text-accent-700 hover:underline">#{o.id}</Link>,
  },
  { key: "date", header: "Date", cell: (o) => <span className="whitespace-nowrap text-ink-muted">{formatDate(o.created_at)}</span> },
  { key: "items", header: "Items", cell: (o) => <span className="text-ink">{itemsSummary(o)}</span> },
  { key: "total", header: "Total", align: "right", cell: (o) => formatInr(o.total) },
  { key: "status", header: "Status", cell: (o) => <Badge kind="status" value={o.order_status} /> },
];

export function MyOrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const id = params.get("id") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [idDraft, setIdDraft] = useState(id);
  const debouncedId = useDebouncedValue(idDraft.trim(), 300);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const clean = /^\d+$/.test(debouncedId) ? debouncedId : "";
    if (clean !== id) update({ id: clean });
    // Only reacts to the debounced search box.
  }, [debouncedId]);

  const query = {
    status: status || undefined, from: from || undefined, to: to || undefined, id: id ? Number(id) : undefined,
    page, page_size: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ["orders", "mine", query], queryFn: () => orders.list(query), placeholderData: keepPreviousData });
  const filtered = Boolean(status || from || to || id);
  const idInvalid = idDraft.trim() !== "" && !/^\d+$/.test(idDraft.trim());

  return (
    <>
      <PageHeader title="My orders" description="Everything your team has ordered, newest first." />

      <Card>
        <div className="grid gap-4 border-b border-line-soft p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
          <Input label="Order number" inputMode="numeric" placeholder="e.g. 23" value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)} leading={<Search className="h-4 w-4" aria-hidden="true" />}
            error={idInvalid ? "Use digits only" : null} />
          <Select label="Status" placeholder="All statuses" value={status}
            options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} onChange={(e) => update({ status: e.target.value })} />
          <Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
          <Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
          <Button variant="ghost" disabled={!filtered} onClick={() => { setIdDraft(""); setParams(new URLSearchParams(), { replace: true }); }}>
            Clear
          </Button>
        </div>

        {list.isPending ? (
          <SkeletonRows rows={6} label="Loading your orders" />
        ) : list.isError ? (
          <ErrorState title="Couldn't load your orders" message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Search className="h-6 w-6" />} title="No orders match these filters"
              description="Try a different status or date range."
              action={<Button variant="secondary" size="sm" onClick={() => { setIdDraft(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No orders yet"
              description="When your team places an order, it will show up here with its status."
              action={<Link to="/shop" className="focus-ring inline-flex h-9 items-center rounded bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700">Go to the shop</Link>} />
          )
        ) : (
          <div className={cn(list.isFetching && "opacity-70 transition-opacity")}>
            <Table
              caption="Your orders"
              columns={columns}
              rows={list.data.items}
              rowKey={(o) => o.id}
              mobileTitle={(o) => <Link to={`/orders/${o.id}`} className="focus-ring rounded text-accent-700">Order #{o.id}</Link>}
            />
            <div className="border-t border-line-soft">
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} noun="orders"
                onPageChange={(p) => update({ page: String(p) })} />
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
