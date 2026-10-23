import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CircleAlert, Mail, MessageSquare, MessagesSquare, NotebookPen, Package, Phone, RefreshCw, Siren, Star, Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  customers, type CustomerDetail, type CustomerStatus, type Insights, type InteractionType, type Sentiment, type TimelineEvent,
} from "../../api";
import { Badge, Button, Modal, PlainText, Select, Textarea, useToast, type Tone } from "../../components/ui";
import { formatDate, formatDateTime, humanize } from "../../lib/format";

// customers_api.py: INTERACTION_TYPES, Sentiment, and InteractionIn.summary 5 to 2000 characters.
export const INTERACTION_TYPES: InteractionType[] = ["call", "email", "meeting", "note", "escalation", "renewal"];
export const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const MIN_SUMMARY = 5;
const MAX_SUMMARY = 2000;

const STATUS_TONE: Record<CustomerStatus, Tone> = { active: "green", at_risk: "red", churned: "neutral" };

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot><span className="sr-only">Account status: </span>{humanize(status)}</Badge>;
}

export type RiskEntry = Insights["customers_at_risk"][number];

/**
 * Account health in plain words, using only what the API defines: the status on the customer
 * record, the back office's at-risk list (with its own reasons and rule), the negative
 * interaction count and the latest interaction. No score is calculated here.
 */
export function AccountHealth({ customer, risk, rule, latest }: {
  customer: CustomerDetail;
  risk: RiskEntry | undefined;
  rule: string | undefined;
  latest: { interaction_type: InteractionType; sentiment: Sentiment; created_at: string } | undefined;
}) {
  const flagged = Boolean(risk);
  return (
    <section aria-labelledby="health-title" className={flagged ? "rounded-card border border-red-dot/30 bg-red-bg/60 p-5" : "rounded-card border border-line bg-white p-5"}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="health-title" className="text-base font-semibold text-ink">Account health</h3>
        {flagged ? <Badge tone="red" dot>At risk</Badge> : <Badge tone="green" dot>Not flagged at risk</Badge>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto,1fr]">
        <dt className="text-ink-subtle">Status on the account</dt>
        <dd className="text-ink">{humanize(customer.status)}</dd>
        {risk && (
          <>
            <dt className="text-ink-subtle">Why it's flagged</dt>
            <dd className="text-ink">{risk.reasons.map(humanize).join("; ")}</dd>
          </>
        )}
        <dt className="text-ink-subtle">Negative interactions</dt>
        <dd className="text-ink">{customer.summary.negative_interactions} in total</dd>
        <dt className="text-ink-subtle">Latest interaction</dt>
        <dd className="flex flex-wrap items-center gap-2 text-ink">
          {latest ? (
            <>
              {humanize(latest.interaction_type)}, {formatDate(latest.created_at)}
              <Badge kind="sentiment" value={latest.sentiment} />
            </>
          ) : "None logged yet"}
        </dd>
      </dl>
      {rule && <p className="mt-3 text-xs text-ink-subtle">At-risk rule used by the back office: {rule}.</p>}
    </section>
  );
}

const EVENT_ICONS: Record<string, ReactNode> = {
  order: <Package className="h-4 w-4" />, issue: <CircleAlert className="h-4 w-4" />, message: <MessagesSquare className="h-4 w-4" />,
  feedback: <Star className="h-4 w-4" />, call: <Phone className="h-4 w-4" />, email: <Mail className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />, note: <NotebookPen className="h-4 w-4" />, escalation: <Siren className="h-4 w-4" />,
  renewal: <RefreshCw className="h-4 w-4" />,
};

/** The combined customer timeline, newest first. Summaries are user-written text, shown as text. */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-4 before:top-2 before:w-px before:bg-line" aria-label="Customer timeline">
      {events.map((event, index) => (
        <li key={`${event.event_at}-${event.event_type}-${index}`} className="relative flex gap-4">
          <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink-subtle" aria-hidden="true">
            {EVENT_ICONS[event.event_type] ?? <CalendarClock className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <span className="font-medium text-ink-muted">{humanize(event.event_type)}</span>
              {event.order_id !== null && (
                <Link to={`/ops/orders/${event.order_id}`} className="focus-ring rounded text-accent-700 hover:underline">Order #{event.order_id}</Link>
              )}
              <time dateTime={event.event_at} className="ml-auto">{formatDateTime(event.event_at)}</time>
            </div>
            <PlainText text={event.summary} className="mt-1 text-sm text-ink" />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AddInteractionModal({ customerId, open, onClose }: { customerId: number; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<InteractionType | "">("");
  const [sentiment, setSentiment] = useState<Sentiment>("neutral");
  const [summary, setSummary] = useState("");
  const [orderId, setOrderId] = useState("");
  const [errors, setErrors] = useState<{ type?: string; summary?: string; form?: string }>({});

  // order_id is optional and must be one of this customer's orders.
  const recentOrders = useQuery({
    queryKey: ["customer", customerId, "orders", { page_size: 100 }],
    queryFn: () => customers.orders(customerId, { page_size: 100 }),
    enabled: open,
  });

  const reset = () => { setType(""); setSentiment("neutral"); setSummary(""); setOrderId(""); setErrors({}); };
  const save = useMutation({
    mutationFn: () => customers.logInteraction(customerId, {
      interaction_type: type as InteractionType, sentiment, summary: summary.trim(), order_id: orderId ? Number(orderId) : null,
    }),
    onSuccess: () => {
      toast({ tone: "success", title: "Interaction logged" });
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      reset();
      onClose();
    },
    onError: (err) => setErrors({ form: err.message }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    const length = summary.trim().length;
    if (!type) next.type = "Choose the type of interaction.";
    if (length < MIN_SUMMARY || length > MAX_SUMMARY) next.summary = `Write ${MIN_SUMMARY} to ${MAX_SUMMARY} characters.`;
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <Modal open={open} onClose={() => { if (!save.isPending) { reset(); onClose(); } }} title="Add interaction"
      description="Internal account history. Customers never see this.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" placeholder="Choose a type" value={type} error={errors.type} data-autofocus
            options={INTERACTION_TYPES.map((t) => ({ value: t, label: humanize(t) }))} onChange={(e) => setType(e.target.value as InteractionType)} />
          <Select label="Sentiment" value={sentiment}
            options={SENTIMENTS.map((s) => ({ value: s, label: humanize(s) }))} onChange={(e) => setSentiment(e.target.value as Sentiment)} />
        </div>
        <Textarea label="Summary" rows={5} maxLength={MAX_SUMMARY} value={summary} error={errors.summary}
          onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed, and any follow-up"
          hint={`${summary.trim().length} / ${MAX_SUMMARY}`} />
        <Select label="Related order (optional)" placeholder="None" value={orderId} onChange={(e) => setOrderId(e.target.value)}
          options={(recentOrders.data?.items ?? []).map((o) => ({ value: String(o.id), label: `#${o.id} · ${formatDate(o.created_at)} · ${humanize(o.order_status)}` }))} />
        {errors.form && <p role="alert" className="text-sm font-medium text-red-fg">{errors.form}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending} loadingLabel="Saving" icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}>Add interaction</Button>
        </div>
      </form>
    </Modal>
  );
}
