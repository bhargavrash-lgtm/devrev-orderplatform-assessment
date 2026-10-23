import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleAlert, Package, Star, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { insights as insightsApi, issues as issuesApi, type Insights, type IssueSeverity, type OrderStatus } from "../../api";
import {
  Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, PlainText, SectionCard, Skeleton, SkeletonCards,
  STATUS_TONE, SEVERITY_TONE, type Tone,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDate, formatDateTime, formatNumber, humanize } from "../../lib/format";

const ORDER_FLOW: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
const SEVERITIES: IssueSeverity[] = ["high", "medium", "low"];
const barColour: Record<Tone, string> = {
  neutral: "bg-neutral-dot", blue: "bg-blue-dot", amber: "bg-amber-dot", violet: "bg-violet-dot",
  green: "bg-green-dot", red: "bg-red-dot", accent: "bg-accent-500",
};

const sum = (values: Record<string, number | undefined>) => Object.values(values).reduce<number>((a, b) => a + (b ?? 0), 0);

/** A stat whose number is a link to the list it counts. */
function LinkedStat({ label, value, to, hint, icon }: { label: string; value: string; to: string; hint?: string; icon: React.ReactNode }) {
  return (
    <Link to={to} className="focus-ring group block rounded-card border border-line bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-raised"
      aria-label={`${label}: ${value}${hint ? `, ${hint}` : ""}. Open the list`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase text-ink-subtle">{label}</p>
        <span className="text-ink-faint group-hover:text-accent-500" aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink group-hover:text-accent-700">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-subtle">{hint}</p>}
    </Link>
  );
}

/** Horizontal bars made of plain divs; each row links to its filtered list. */
function BarList({ label, rows }: { label: string; rows: Array<{ key: string; label: string; value: number; tone: Tone; to: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <Link to={row.to} className="focus-ring group grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 rounded px-1 py-0.5 text-sm hover:bg-page"
            aria-label={`${row.label}: ${row.value}`}>
            <span className="truncate text-ink-muted group-hover:text-ink">{row.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
              <span className={cn("block h-full rounded-full", barColour[row.tone])} style={{ width: `${(row.value / max) * 100}%` }} />
            </span>
            <span className="text-right font-medium tabular-nums text-ink">{row.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Stats({ data }: { data: Insights }) {
  const totalOrders = sum(data.orders_by_status);
  const unresolved = sum(data.unresolved_issues_by_category);
  const offline = data.orders_by_client_network.offline_sync ?? 0;
  const weak = data.orders_by_client_network.weak ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <LinkedStat label="Orders" value={formatNumber(totalOrders)} to="/ops/orders" icon={<Package className="h-4 w-4" />}
        hint={`${data.orders_by_status.placed ?? 0} waiting to be confirmed`} />
      <LinkedStat label="Unresolved issues" value={String(unresolved)} to="/ops/issues" icon={<CircleAlert className="h-4 w-4" />}
        hint={`${data.issues_by_status.open ?? 0} open, ${data.issues_by_status.investigating ?? 0} investigating`} />
      <LinkedStat label="Open issues" value={String(data.issues_by_status.open ?? 0)} to="/ops/issues?status=open"
        icon={<AlertTriangle className="h-4 w-4" />} hint="Newly reported, not yet picked up" />
      <LinkedStat label="Offline-synced orders" value={String(offline)} to="/ops/orders?client_network=offline_sync"
        icon={<WifiOff className="h-4 w-4" />} hint={`plus ${weak} on a weak signal`} />
      <LinkedStat label="Average rating" value={data.feedback.average_rating !== null ? `${data.feedback.average_rating.toFixed(2)} / 5` : "No ratings"}
        to="/ops/customers?sort=avg_rating" icon={<Star className="h-4 w-4" />} hint={`from ${data.feedback.count} order ratings`} />
    </div>
  );
}

function RecentIssues() {
  const recent = useQuery({ queryKey: ["issues", { status: "unresolved", page_size: 6 }], queryFn: () => issuesApi.list({ page_size: 6 }) });
  return (
    <SectionCard title="Latest unresolved issues" actions={<Link to="/ops/issues" className="focus-ring rounded text-sm font-medium text-accent-700 hover:underline">All issues</Link>} flush>
      {recent.isPending ? (
        <LoadingState label="Loading issues" className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</LoadingState>
      ) : recent.isError ? (
        <ErrorState message={recent.error.message} onRetry={() => void recent.refetch()} className="py-8" />
      ) : recent.data.items.length === 0 ? (
        <EmptyState title="Nothing unresolved" description="Every reported issue is resolved." className="py-8" />
      ) : (
        <ul className="divide-y divide-line-soft">
          {recent.data.items.map((issue) => (
            <li key={issue.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link to={`/ops/orders/${issue.order_id}?tab=issues`} className="focus-ring rounded font-medium text-ink hover:text-accent-700">
                  {humanize(issue.category)} · order #{issue.order_id}
                </Link>
                <Badge kind="severity" value={issue.severity} />
                <Badge kind="issueStatus" value={issue.status} />
                <span className="ml-auto text-xs text-ink-subtle">{issue.customer.name} · {formatDate(issue.created_at)}</span>
              </div>
              <PlainText text={issue.description} className="mt-1 line-clamp-1 text-sm text-ink-muted" />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function DashboardPage() {
  const query = useQuery({ queryKey: ["insights"], queryFn: insightsApi.get });

  return (
    <>
      <PageHeader title="Dashboard" description="How orders, issues and accounts are doing right now." />
      {query.isPending ? (
        <div className="space-y-6"><SkeletonCards count={5} label="Loading insights" /><Skeleton className="h-64" /></div>
      ) : query.isError ? (
        <Card><ErrorState title="Couldn't load the dashboard" message={query.error.message} onRetry={() => void query.refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <Stats data={query.data} />

          <div className="grid gap-6 lg:grid-cols-3">
            <SectionCard title="Orders by status">
              <BarList label="Orders by status" rows={ORDER_FLOW.map((status) => ({
                key: status, label: humanize(status), value: query.data.orders_by_status[status] ?? 0, tone: STATUS_TONE[status], to: `/ops/orders?status=${status}`,
              }))} />
            </SectionCard>
            <SectionCard title="Unresolved by severity" description="Open or investigating">
              <BarList label="Unresolved issues by severity" rows={SEVERITIES.map((severity) => ({
                key: severity, label: humanize(severity), value: query.data.unresolved_issues_by_severity[severity] ?? 0,
                tone: SEVERITY_TONE[severity], to: `/ops/issues?severity=${severity}`,
              }))} />
            </SectionCard>
            <SectionCard title="Ratings" description={`${query.data.feedback.count} order ratings`}>
              <BarList label="Ratings distribution" rows={(["5", "4", "3", "2", "1"] as const).map((stars) => ({
                key: stars, label: `${stars} star${stars === "1" ? "" : "s"}`, value: query.data.feedback.ratings_distribution[stars],
                tone: Number(stars) >= 4 ? "green" : Number(stars) === 3 ? "amber" : "red", to: "/ops/customers?sort=avg_rating",
              }))} />
            </SectionCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Recurring issues" description="Categories with 2 or more issues, every status counted" flush>
              {query.data.recurring_issues_by_category.length === 0 ? (
                <EmptyState title="No recurring issues" description="No category has more than one issue." className="py-8" />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {query.data.recurring_issues_by_category.map((group) => (
                    <li key={group.category}>
                      <Link to={`/ops/issues?status=all&category=${group.category}`} className="focus-ring flex items-center gap-4 px-5 py-3 hover:bg-page">
                        <span className="w-10 text-2xl font-semibold tabular-nums text-ink">{group.issue_count}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium text-ink">
                            {humanize(group.category)}
                            {group.category === "duplicate_order" && <Badge tone="accent">Duplicates</Badge>}
                          </span>
                          <span className="block text-xs text-ink-subtle">
                            {group.unresolved} unresolved · {group.resolved} resolved · {group.customers_affected.join(", ")}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Customers at risk" description={query.data.notes.customers_at_risk ? humanize(query.data.notes.customers_at_risk) : undefined} flush>
              {query.data.customers_at_risk.length === 0 ? (
                <EmptyState title="No accounts at risk" description="No customer meets the at-risk rule right now." className="py-8" />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {query.data.customers_at_risk.map((customer) => (
                    <li key={customer.customer_id}>
                      <Link to={`/ops/customers/${customer.customer_id}`} className="focus-ring block px-5 py-3 hover:bg-page">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">{customer.name}</span>
                          <Badge tone="red" dot>At risk</Badge>
                          {customer.renewal_date && <span className="ml-auto text-xs text-ink-subtle">Renews {formatDate(customer.renewal_date)}</span>}
                        </span>
                        <span className="mt-1 block text-xs text-ink-muted">
                          {customer.reasons.map(humanize).join(" · ")} · {customer.unresolved_issues} unresolved issues
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <RecentIssues />
            <SectionCard title="Latest activity" description="Across all customers" flush>
              <ul className="divide-y divide-line-soft">
                {query.data.recent_events.map((event, index) => (
                  <li key={`${event.event_at}-${index}`} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-ink-subtle">
                      <Badge tone="neutral">{humanize(event.event_type)}</Badge>
                      <Link to={`/ops/customers/${event.customer_id}`} className="focus-ring rounded font-medium text-ink-muted hover:text-accent-700">{event.customer_name}</Link>
                      <span className="ml-auto">{formatDateTime(event.event_at)}</span>
                    </div>
                    <PlainText text={event.summary} className="mt-1 line-clamp-2 text-sm text-ink" />
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        </div>
      )}
    </>
  );
}
