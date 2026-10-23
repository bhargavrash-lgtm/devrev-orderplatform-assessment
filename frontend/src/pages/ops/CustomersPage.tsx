import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { customers as customersApi, insights as insightsApi, type CustomerRecord } from "../../api";
import { DebouncedFilter } from "../../components/DebouncedFilter";
import {
  Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, SkeletonRows, Stars, Table, type Column,
} from "../../components/ui";
import { CustomerStatusBadge } from "../../features/customers/CustomerParts";
import { cn } from "../../lib/cn";
import { formatDate, formatInr, humanize } from "../../lib/format";
import { useUrlFilters } from "../../lib/useUrlFilters";

const PAGE_SIZE = 25;
// CUSTOMER_SORTS in customers_api.py.
const SORTS = [
  { value: "-unresolved_issues", label: "Most unresolved issues" },
  { value: "avg_rating", label: "Lowest average rating" },
  { value: "-lifetime_value", label: "Highest lifetime value" },
  { value: "-last_order_at", label: "Most recent order" },
  { value: "name", label: "Name, A to Z" },
];

export function CustomersPage() {
  const filters = useUrlFilters();
  const query = {
    name: filters.get("name") || undefined,
    status: filters.get("status") || undefined,
    tier: filters.get("tier") || undefined,
    sort: filters.get("sort", "-unresolved_issues"),
    page: filters.page,
    page_size: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ["customers", query], queryFn: () => customersApi.list(query), placeholderData: keepPreviousData });
  // The back office's own at-risk list (status at_risk, or repeated negative interactions).
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.get, staleTime: 60_000 });
  const risk = new Map((insights.data?.customers_at_risk ?? []).map((r) => [r.customer_id, r]));
  const filtered = Boolean(query.name || query.status || query.tier);

  const columns: Column<CustomerRecord>[] = [
    { key: "company", header: "Company", hideOnMobile: true, cell: (c) => (
      <Link to={`/ops/customers/${c.id}`} className="focus-ring group block rounded">
        <span className="font-medium text-ink group-hover:text-accent-700">{c.name}</span>
        <span className="block text-xs text-ink-subtle">{c.customer_code} · {humanize(c.tier)} · {c.city}</span>
      </Link>
    ) },
    { key: "health", header: "Health", cell: (c) => {
      const flagged = risk.get(c.id);
      return (
        <div className="space-y-1">
          {flagged ? <Badge tone="red" dot>At risk</Badge> : <CustomerStatusBadge status={c.status} />}
          {flagged && <span className="block max-w-[14rem] text-xs text-ink-subtle">{flagged.reasons.map(humanize).join("; ")}</span>}
        </div>
      );
    } },
    { key: "sentiment", header: "Negative interactions", align: "right", cell: (c) => (
      <span className={c.summary.negative_interactions > 0 ? "font-medium text-red-fg" : "text-ink-subtle"}>{c.summary.negative_interactions}</span>
    ) },
    { key: "orders", header: "Orders", align: "right", cell: (c) => c.summary.order_count },
    { key: "issues", header: "Unresolved issues", align: "right", cell: (c) => (
      <Link to={`/ops/issues?customer=${encodeURIComponent(c.name)}`} className="focus-ring rounded hover:text-accent-700"
        aria-label={`${c.summary.unresolved_issues} unresolved issues for ${c.name}: ${c.summary.open_issues_only} open, ${c.summary.investigating_issues} investigating`}>
        <span className="font-medium">{c.summary.unresolved_issues}</span>
        <span className="block text-2xs text-ink-subtle">{c.summary.open_issues_only} open · {c.summary.investigating_issues} inv.</span>
      </Link>
    ) },
    { key: "rating", header: "Avg rating", cell: (c) => (c.summary.avg_rating !== null
      ? <span className="inline-flex items-center gap-1.5"><Stars value={c.summary.avg_rating} /><span className="tabular-nums text-ink-muted">{c.summary.avg_rating.toFixed(1)}</span></span>
      : <span className="text-ink-faint">No ratings</span>) },
    { key: "value", header: "Lifetime value", align: "right", cell: (c) => formatInr(c.summary.lifetime_value) },
    { key: "renewal", header: "Renewal", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{c.renewal_date ? formatDate(c.renewal_date) : "None"}</span> },
    { key: "owner", header: "Owner", cell: (c) => <span className="text-ink-muted">{c.account_owner?.name ?? "Unassigned"}</span> },
  ];

  return (
    <>
      <PageHeader title="Customers" description="Accounts, their health and who owns them. Sorted by unresolved issues so accounts that need attention come first." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-4">
          <div className="w-full sm:w-72">
            <DebouncedFilter label="Search" value={filters.get("name")} placeholder="Company name"
              leading={<Search className="h-4 w-4" aria-hidden="true" />} onCommit={(v) => filters.set({ name: v })} />
          </div>
          <div className="w-44">
            <Select label="Status" placeholder="Any status" value={filters.get("status")} onChange={(e) => filters.set({ status: e.target.value })}
              options={["active", "at_risk", "churned"].map((s) => ({ value: s, label: humanize(s) }))} />
          </div>
          <div className="w-44">
            <Select label="Tier" placeholder="Any tier" value={filters.get("tier")} onChange={(e) => filters.set({ tier: e.target.value })}
              options={["enterprise", "mid_market", "small"].map((t) => ({ value: t, label: humanize(t) }))} />
          </div>
          <div className="w-56">
            <Select label="Sort" options={SORTS} value={query.sort} onChange={(e) => filters.set({ sort: e.target.value })} />
          </div>
          <Button variant={query.status === "at_risk" ? "primary" : "secondary"} aria-pressed={query.status === "at_risk"}
            onClick={() => filters.set({ status: query.status === "at_risk" ? null : "at_risk" })}>
            At risk only
          </Button>
          {filtered && <Button variant="ghost" onClick={() => filters.clear(["sort"])}>Clear</Button>}
        </div>

        {list.isPending ? (
          <SkeletonRows rows={5} label="Loading customers" />
        ) : list.isError ? (
          <ErrorState title="Couldn't load customers" message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={filtered ? "No customers match" : "No customers yet"}
            description={filtered ? "Try another name or status." : "Customers will appear here once they're added."}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => filters.clear(["sort"])}>Clear filters</Button> : undefined} />
        ) : (
          <div className={cn(list.isFetching && "opacity-70 transition-opacity")}>
            <Table caption="Customers" columns={columns} rows={list.data.items} rowKey={(c) => c.id} compact stickyHeader
              mobileTitle={(c) => <Link to={`/ops/customers/${c.id}`} className="focus-ring rounded text-accent-700">{c.name}</Link>} />
            {list.data.total > PAGE_SIZE && (
              <div className="border-t border-line-soft">
                <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.total} noun="customers"
                  onPageChange={(p) => filters.set({ page: String(p) })} />
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
