import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlert, Pencil, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { issues as issuesApi, type Issue, type IssueStatusFilter } from "../../api";
import { DebouncedFilter } from "../../components/DebouncedFilter";
import {
  Badge, Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Pagination, PlainText, Select, SkeletonRows, Table,
  type Column,
} from "../../components/ui";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES, IssueEditor } from "../../features/issues/IssueEditor";
import { cn } from "../../lib/cn";
import { formatDate, humanize } from "../../lib/format";
import { useUrlFilters } from "../../lib/useUrlFilters";

const PAGE_SIZE = 25;
// GET /api/issues status values. "unresolved" (the default) means open or investigating.
const STATUS_FILTERS: Array<{ value: IssueStatusFilter; label: string }> = [
  { value: "unresolved", label: "Unresolved (open + investigating)" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All issues" },
];
// ISSUE_SORTS in records_api.py: created_at, severity, status.
const SORTS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-severity", label: "Most severe first" },
  { value: "status", label: "Status: open first" },
];

export function IssuesPage() {
  const filters = useUrlFilters();
  const [editing, setEditing] = useState<Issue | null>(null);
  const status = filters.get("status", "unresolved") as IssueStatusFilter;
  const query = {
    status,
    severity: filters.get("severity") || undefined,
    category: filters.get("category") || undefined,
    customer: filters.get("customer") || undefined,
    jira_key: filters.get("jira_key") || undefined,
    sort: filters.get("sort", "-created_at"),
    page: filters.page,
    page_size: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ["issues", query], queryFn: () => issuesApi.list(query), placeholderData: keepPreviousData });
  const filtered = ["severity", "category", "customer", "jira_key"].some((key) => filters.get(key)) || status !== "unresolved";

  const columns: Column<Issue>[] = [
    { key: "issue", header: "Issue", hideOnMobile: true, cell: (i) => (
      <div className="min-w-[14rem] max-w-md">
        <span className="font-medium text-ink">#{i.id} · {humanize(i.category)}</span>
        <PlainText as="span" text={i.description} className="line-clamp-1 block text-xs text-ink-subtle" />
      </div>
    ) },
    { key: "severity", header: "Severity", cell: (i) => <Badge kind="severity" value={i.severity} /> },
    { key: "status", header: "Status", cell: (i) => <Badge kind="issueStatus" value={i.status} /> },
    { key: "jira", header: "Jira", cell: (i) => (i.jira_key ? <span className="font-mono text-xs text-accent-700">{i.jira_key}</span> : <span className="text-ink-faint">None</span>) },
    { key: "order", header: "Order",
      cell: (i) => <Link to={`/ops/orders/${i.order_id}?tab=issues`} className="focus-ring rounded text-accent-700 hover:underline">#{i.order_id}</Link> },
    { key: "customer", header: "Customer",
      cell: (i) => <Link to={`/ops/customers/${i.customer.id}`} className="focus-ring rounded text-ink hover:text-accent-700">{i.customer.name}</Link> },
    { key: "reported", header: "Reported", cell: (i) => <span className="whitespace-nowrap text-ink-muted">{formatDate(i.created_at)}</span> },
    { key: "edit", header: "Edit", cell: (i) => (
      <IconButton label={`Edit issue ${i.id}`} onClick={() => setEditing(i)}><Pencil className="h-4 w-4" aria-hidden="true" /></IconButton>
    ) },
  ];

  return (
    <>
      <PageHeader title="Issues" description="Problems reported on orders. By default: unresolved, which means open or investigating." />
      <Card>
        <div className="grid gap-3 border-b border-line-soft p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Select label="Status" options={STATUS_FILTERS} value={status} onChange={(e) => filters.set({ status: e.target.value === "unresolved" ? null : e.target.value })} />
          <Select label="Severity" placeholder="Any severity" value={filters.get("severity")}
            options={ISSUE_SEVERITIES.map((s) => ({ value: s, label: humanize(s) }))} onChange={(e) => filters.set({ severity: e.target.value })} />
          <Select label="Category" placeholder="Any category" value={filters.get("category")}
            options={ISSUE_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} onChange={(e) => filters.set({ category: e.target.value })} />
          <DebouncedFilter label="Customer" value={filters.get("customer")} placeholder="Name contains"
            leading={<Search className="h-4 w-4" aria-hidden="true" />} onCommit={(v) => filters.set({ customer: v })} />
          <DebouncedFilter label="Jira key" value={filters.get("jira_key")} placeholder="SCRUM-24" onCommit={(v) => filters.set({ jira_key: v.toUpperCase() })} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5">
          <p className="text-sm text-ink-subtle" aria-live="polite">{list.data ? `${list.data.total} ${list.data.total === 1 ? "issue" : "issues"}` : " "}</p>
          <div className="flex items-center gap-2">
            <div className="w-52"><Select label="Sort" hideLabel options={SORTS} value={query.sort} onChange={(e) => filters.set({ sort: e.target.value })} /></div>
            <Button variant="ghost" size="sm" disabled={!filtered} onClick={() => filters.clear(["sort"])}>Reset</Button>
          </div>
        </div>

        {list.isPending ? (
          <SkeletonRows rows={8} label="Loading issues" />
        ) : list.isError ? (
          <ErrorState title="Couldn't load issues" message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<CircleAlert className="h-6 w-6" />}
            title={filtered ? "No issues match these filters" : "Nothing unresolved"}
            description={filtered ? "Try another status or fewer filters." : "Every reported issue has been resolved."}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => filters.clear(["sort"])}>Reset filters</Button> : undefined} />
        ) : (
          <div className={cn(list.isFetching && "opacity-70 transition-opacity")}>
            <Table caption="Issues" columns={columns} rows={list.data.items} rowKey={(i) => i.id} compact stickyHeader
              mobileTitle={(i) => <span>#{i.id} · {humanize(i.category)}</span>} />
            <div className="border-t border-line-soft">
              <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.total} noun="issues"
                onPageChange={(p) => filters.set({ page: String(p) })} />
            </div>
          </div>
        )}
      </Card>
      <IssueEditor issue={editing} onClose={() => setEditing(null)} />
    </>
  );
}
