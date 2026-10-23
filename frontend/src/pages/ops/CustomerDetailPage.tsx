import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Clock, MessageSquarePlus, Package, Star, Users } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError, customers as customersApi, insights as insightsApi, type CustomerDetail, type InteractionType, type OrderStatus,
  type Sentiment, type TimelineEventType,
} from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Pagination, PlainText, SectionCard, Select, Skeleton,
  SkeletonRows, StatCard, Stars, Table, Tabs,
} from "../../components/ui";
import {
  AccountHealth, AddInteractionModal, CustomerStatusBadge, INTERACTION_TYPES, SENTIMENTS, TimelineList,
} from "../../features/customers/CustomerParts";
import { itemsSummary } from "../../features/order/OrderSections";
import { cn } from "../../lib/cn";
import { formatDate, formatDateTime, formatInr, humanize } from "../../lib/format";
import { NotFoundContent } from "../NotFoundPage";

const TABS = ["overview", "orders", "timeline", "interactions"] as const;
type TabId = (typeof TABS)[number];
const TIMELINE_TYPES: TimelineEventType[] = ["order", "issue", "message", "feedback", ...INTERACTION_TYPES];
const ORDER_STATUSES: OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem,1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function ProfileColumn({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="space-y-6">
      <SectionCard title="Profile">
        <dl className="divide-y divide-line-soft">
          <Field label="Industry">{customer.industry ?? "Not set"}</Field>
          <Field label="Tier">{humanize(customer.tier)}</Field>
          <Field label="Region">{customer.region ?? "Not set"}</Field>
          <Field label="Location">{[customer.city, customer.state].filter(Boolean).join(", ") || "Not set"}</Field>
          <Field label="Contract value">{customer.annual_contract_value !== null ? `${formatInr(customer.annual_contract_value)} a year` : "Not set"}</Field>
          <Field label="Renewal">{customer.renewal_date ? formatDate(customer.renewal_date) : "Not set"}</Field>
          <Field label="Customer since">{customer.customer_since ? formatDate(customer.customer_since) : "Not set"}</Field>
          <Field label="Account owner">{customer.account_owner?.name ?? "Unassigned"}</Field>
          <Field label="Orders email">{customer.contact_email ?? "Not set"}</Field>
        </dl>
      </SectionCard>
      <SectionCard title="Contacts" flush>
        {customer.contacts.length === 0 ? (
          <EmptyState title="No contacts" className="py-6" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {customer.contacts.map((contact) => (
              <li key={contact.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{contact.full_name}</span>
                  {contact.is_primary && <Badge tone="accent">Primary</Badge>}
                </div>
                {contact.title && <p className="text-ink-subtle">{contact.title}</p>}
                <p className="mt-0.5 text-ink-muted">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Addresses" flush>
        <ul className="divide-y divide-line-soft">
          {customer.addresses.map((address) => (
            <li key={address.id} className="px-5 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{address.label}</span>
                {address.is_default && <Badge tone="neutral">Default</Badge>}
              </div>
              <p className="text-ink-muted">{address.line1}, {[address.city, address.state, address.pincode].filter(Boolean).join(", ")}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function OrdersTab({ customerId }: { customerId: number }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const query = { status: status || undefined, page, page_size: 10 };
  const list = useQuery({ queryKey: ["customer", customerId, "orders", query], queryFn: () => customersApi.orders(customerId, query),
    placeholderData: keepPreviousData });
  return (
    <div className="space-y-3">
      <div className="w-48">
        <Select label="Status" placeholder="Any status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          options={ORDER_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      {list.isPending ? <SkeletonRows rows={4} label="Loading orders" />
        : list.isError ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        : list.data.items.length === 0 ? <EmptyState icon={<Package className="h-6 w-6" />} title="No orders" description={status ? "None with this status." : "This customer hasn't ordered yet."} className="py-8" />
        : (
          <div className="rounded-card border border-line">
            <Table caption="Customer orders" compact rows={list.data.items} rowKey={(o) => o.id}
              mobileTitle={(o) => <Link to={`/ops/orders/${o.id}`} className="focus-ring rounded text-accent-700">Order #{o.id}</Link>}
              columns={[
                { key: "id", header: "Order", hideOnMobile: true, cell: (o) => <Link to={`/ops/orders/${o.id}`} className="focus-ring rounded font-medium text-accent-700 hover:underline">#{o.id}</Link> },
                { key: "date", header: "Placed", cell: (o) => <span className="whitespace-nowrap text-ink-muted">{formatDate(o.created_at)}</span> },
                { key: "items", header: "Items", cell: (o) => <span className="text-ink-muted">{itemsSummary(o)}</span> },
                { key: "total", header: "Total", align: "right", cell: (o) => formatInr(o.total) },
                { key: "status", header: "Status", cell: (o) => <Badge kind="status" value={o.order_status} /> },
              ]} />
            <div className="border-t border-line-soft">
              <Pagination page={page} pageSize={10} total={list.data.total} noun="orders" onPageChange={setPage} />
            </div>
          </div>
        )}
    </div>
  );
}

function TimelineTab({ customerId }: { customerId: number }) {
  const [types, setTypes] = useState<TimelineEventType[]>([]);
  const [page, setPage] = useState(1);
  const query = { event_types: types.length ? types.join(",") : undefined, page, page_size: 50 };
  const timeline = useQuery({ queryKey: ["customer", customerId, "timeline", query], queryFn: () => customersApi.timeline(customerId, query),
    placeholderData: keepPreviousData });
  const toggle = (type: TimelineEventType) => {
    setTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
    setPage(1);
  };
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Show event types" className="flex flex-wrap gap-1.5">
        {TIMELINE_TYPES.map((type) => {
          const active = types.includes(type);
          return (
            <button key={type} type="button" aria-pressed={active} onClick={() => toggle(type)}
              className={cn("focus-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active ? "border-accent-600 bg-accent-600 text-white" : "border-line-strong bg-white text-ink-muted hover:border-accent-300")}>
              {humanize(type)}
            </button>
          );
        })}
        {types.length > 0 && <Button variant="ghost" size="sm" onClick={() => setTypes([])}>Show all</Button>}
      </div>
      {timeline.isPending ? (
        <LoadingState label="Loading timeline" className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</LoadingState>
      ) : timeline.isError ? (
        <ErrorState message={timeline.error.message} onRetry={() => void timeline.refetch()} />
      ) : timeline.data.items.length === 0 ? (
        <EmptyState icon={<Clock className="h-6 w-6" />} title="Nothing here yet" description={types.length ? "No events of these types." : "This customer has no history yet."} className="py-8" />
      ) : (
        <>
          <TimelineList events={timeline.data.items} />
          {timeline.data.total > 50 && <Pagination page={page} pageSize={50} total={timeline.data.total} noun="events" onPageChange={setPage} />}
        </>
      )}
    </div>
  );
}

function InteractionsTab({ customerId }: { customerId: number }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [page, setPage] = useState(1);
  const query = { interaction_type: type || undefined, sentiment: sentiment || undefined, page, page_size: 20 };
  const list = useQuery({ queryKey: ["customer", customerId, "interactions", query], queryFn: () => customersApi.interactions(customerId, query),
    placeholderData: keepPreviousData });
  const addButton = (
    <Button size="sm" icon={<MessageSquarePlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>Add interaction</Button>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40"><Select label="Type" placeholder="Any type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}
          options={INTERACTION_TYPES.map((t) => ({ value: t, label: humanize(t) }))} /></div>
        <div className="w-40"><Select label="Sentiment" placeholder="Any" value={sentiment} onChange={(e) => { setSentiment(e.target.value); setPage(1); }}
          options={SENTIMENTS.map((s) => ({ value: s, label: humanize(s) }))} /></div>
        <div className="ml-auto">{addButton}</div>
      </div>
      {list.isPending ? <SkeletonRows rows={3} label="Loading interactions" />
        : list.isError ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        : list.data.items.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={type || sentiment ? "No interactions match" : "No interactions yet"}
            description="Log calls, emails, meetings and notes to build the account history." className="py-8" />
        ) : (
          <>
            <ul className="space-y-3" aria-label="Interactions">
              {list.data.items.map((item) => (
                <li key={item.id} className="rounded-card border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{humanize(item.interaction_type)}</span>
                    <Badge kind="sentiment" value={item.sentiment as Sentiment} />
                    {item.order_id !== null && <Link to={`/ops/orders/${item.order_id}`} className="focus-ring rounded text-xs text-accent-700 hover:underline">Order #{item.order_id}</Link>}
                    <span className="ml-auto text-xs text-ink-subtle">{item.created_by_name} · {formatDateTime(item.created_at)}</span>
                  </div>
                  <PlainText text={item.summary} className="mt-2 text-sm text-ink" />
                </li>
              ))}
            </ul>
            {list.data.total > 20 && <Pagination page={page} pageSize={20} total={list.data.total} noun="interactions" onPageChange={setPage} />}
          </>
        )}
      <AddInteractionModal customerId={customerId} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function Overview({ customer }: { customer: CustomerDetail }) {
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.get, staleTime: 60_000 });
  const latest = useQuery({
    queryKey: ["customer", customer.id, "interactions", { page_size: 1 }],
    queryFn: () => customersApi.interactions(customer.id, { page_size: 1 }),
  });
  const recent = useQuery({
    queryKey: ["customer", customer.id, "timeline", { page_size: 8 }],
    queryFn: () => customersApi.timeline(customer.id, { page_size: 8 }),
  });
  const first = latest.data?.items[0];
  return (
    <div className="space-y-6">
      {insights.isPending || latest.isPending ? <Skeleton className="h-40" /> : (
        <AccountHealth
          customer={customer}
          risk={insights.data?.customers_at_risk.find((r) => r.customer_id === customer.id)}
          rule={insights.data?.notes.customers_at_risk}
          latest={first ? { interaction_type: first.interaction_type as InteractionType, sentiment: first.sentiment as Sentiment, created_at: first.created_at } : undefined}
        />
      )}
      <div>
        <h3 className="mb-3 text-base font-semibold text-ink">Recent activity</h3>
        {recent.isPending ? <Skeleton className="h-40" />
          : recent.isError ? <ErrorState message={recent.error.message} onRetry={() => void recent.refetch()} />
          : recent.data.items.length === 0 ? <EmptyState title="No activity yet" className="py-6" />
          : <TimelineList events={recent.data.items} />}
      </div>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const customerId = Number(id);
  const valid = Number.isInteger(customerId) && customerId > 0;
  const [params, setParams] = useSearchParams();
  const tab: TabId = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as TabId) : "overview";
  const setTab = (next: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", next); return n; }, { replace: true });
  const query = useQuery({ queryKey: ["customer", customerId], queryFn: () => customersApi.get(customerId), enabled: valid });

  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <Card><NotFoundContent description="There's no customer with that id." /></Card>;
  }
  if (query.isPending) {
    return (
      <LoadingState label="Loading customer" className="space-y-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      </LoadingState>
    );
  }
  if (query.isError) {
    return <Card><ErrorState title="Couldn't load this customer" message={query.error.message} onRetry={() => void query.refetch()} /></Card>;
  }
  const customer = query.data;
  const s = customer.summary;

  return (
    <>
      <Link to="/ops/customers" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded text-sm text-ink-subtle hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Customers
      </Link>
      <div className="mb-section flex flex-wrap items-start gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-card bg-accent-50 text-accent-700" aria-hidden="true"><Building2 className="h-6 w-6" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{customer.name}</h1>
            <CustomerStatusBadge status={customer.status} />
            <Badge tone="neutral">{humanize(customer.tier)}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-subtle">
            {customer.customer_code} · {customer.industry ?? "Industry not set"} · owned by {customer.account_owner?.name ?? "nobody yet"}
          </p>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Orders" value={s.order_count} hint={s.last_order_at ? `Last ${formatDate(s.last_order_at)}` : "None yet"} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Lifetime value" value={formatInr(s.lifetime_value)} hint="Excluding cancelled orders" />
        <StatCard label="Unresolved issues" value={s.unresolved_issues} hint={`${s.open_issues_only} open · ${s.investigating_issues} investigating · ${s.total_issues} total`} />
        <StatCard label="Average rating" value={s.avg_rating !== null ? s.avg_rating.toFixed(2) : "None"}
          hint={s.avg_rating !== null ? <Stars value={s.avg_rating} /> : "No order ratings yet"} icon={<Star className="h-4 w-4" />} />
        <StatCard label="Negative interactions" value={s.negative_interactions} hint="All time" />
        <StatCard label="Last interaction" value={s.last_interaction_at ? formatDate(s.last_interaction_at) : "None"} hint={customer.renewal_date ? `Renews ${formatDate(customer.renewal_date)}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <ProfileColumn customer={customer} />
        <Card className="min-w-0 p-5">
          <Tabs label="Customer details" value={tab} onChange={setTab} items={[
            { id: "overview", label: "Overview", content: <Overview customer={customer} /> },
            { id: "orders", label: "Orders", count: s.order_count, content: <OrdersTab customerId={customer.id} /> },
            { id: "timeline", label: "Timeline", content: <TimelineTab customerId={customer.id} /> },
            { id: "interactions", label: "Interactions", content: <InteractionsTab customerId={customer.id} /> },
          ]} />
        </Card>
      </div>
    </>
  );
}
