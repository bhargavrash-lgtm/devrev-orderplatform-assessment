import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, XCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ApiError, orders, type Order, type OrderStatus } from "../../api";
import { Badge, Button, Card, ErrorState, Modal, SectionCard, Tabs, useToast } from "../../components/ui";
import { AttachmentsTab } from "../../features/order/AttachmentsTab";
import { ConversationTab } from "../../features/order/ConversationTab";
import { FeedbackTab } from "../../features/order/FeedbackTab";
import { IssuesTab } from "../../features/order/IssuesTab";
import { DeliveryCard, ItemsCard, networkLabel, ProgressCard } from "../../features/order/OrderSections";
import { formatDateTime, formatInr, humanize } from "../../lib/format";
import { OrderDetailSkeleton, useTab } from "../../features/order/orderPage";
import { NotFoundContent } from "../NotFoundPage";

// Mirrors orders_api.py NEXT_STATUS and CANCELLABLE; the backend still checks every change.
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: "confirmed", confirmed: "packed", packed: "shipped", shipped: "delivered",
};
const CANCELLABLE: OrderStatus[] = ["placed", "confirmed", "packed"];
const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: "Confirm order", packed: "Mark as packed", shipped: "Mark as shipped", delivered: "Mark as delivered",
};

function StatusControl({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_STATUS[order.order_status];
  const canCancel = CANCELLABLE.includes(order.order_status);

  const change = useMutation({
    mutationFn: (status: OrderStatus) => orders.setStatus(order.id, status),
    onSuccess: (updated) => {
      setError(null);
      setConfirmCancel(false);
      queryClient.setQueryData(["order", order.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", order.customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["products"] }); // a cancel puts stock back
      toast({ tone: "success", title: `Order #${order.id} is now ${humanize(updated.order_status).toLowerCase()}` });
    },
    onError: (err) => {
      setError(err.message);
      toast({ tone: "error", title: "Status not changed", description: err.message });
    },
  });

  return (
    <SectionCard title="Status" description={next || canCancel ? "Move the order one step at a time." : "This order is closed; its status can't change."}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge kind="status" value={order.order_status} />
        {next && (
          <Button size="sm" onClick={() => change.mutate(next)} loading={change.isPending && change.variables === next}
            loadingLabel="Saving" disabled={change.isPending} icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
            {NEXT_LABEL[next]}
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(true)} disabled={change.isPending}
            icon={<XCircle className="h-4 w-4 text-red-fg" aria-hidden="true" />}>
            Cancel order
          </Button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-fg">{error}</p>}

      <Modal
        open={confirmCancel}
        onClose={() => { if (!change.isPending) setConfirmCancel(false); }}
        title={`Cancel order #${order.id}?`}
        description="This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={change.isPending} data-autofocus>Keep order</Button>
            <Button variant="danger" loading={change.isPending} loadingLabel="Cancelling" onClick={() => change.mutate("cancelled")}>
              Cancel order
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {order.customer.name} will see the order as cancelled, and the {order.item_count === 1 ? "item goes" : `${order.item_count} items go`} back into stock.
        </p>
      </Modal>
    </SectionCard>
  );
}

export function OpsOrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const valid = Number.isInteger(orderId) && orderId > 0;
  const [tab, setTab] = useTab();
  const query = useQuery({ queryKey: ["order", orderId], queryFn: () => orders.get(orderId), enabled: valid });

  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <Card><NotFoundContent description="There's no order with that number." /></Card>;
  }
  if (query.isPending) return <OrderDetailSkeleton />;
  if (query.isError) {
    return <Card><ErrorState title="Couldn't load this order" message={query.error.message} onRetry={() => void query.refetch()} /></Card>;
  }
  const order = query.data;

  return (
    <>
      <Link to="/ops/orders" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded text-sm text-ink-subtle hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Orders
      </Link>
      <div className="mb-section flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Order #{order.id}</h1>
            <Badge kind="status" value={order.order_status} />
            {order.client_network !== "good" && <Badge tone={order.client_network === "offline_sync" ? "amber" : "neutral"}>{networkLabel(order.client_network)}</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-ink-subtle">Placed {formatDateTime(order.created_at)} · last change {formatDateTime(order.updated_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-2xs font-semibold uppercase text-ink-subtle">Total</p>
          <p className="text-2xl font-semibold tabular-nums text-ink">{formatInr(order.total)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title="Customer">
            <Link to={`/ops/customers/${order.customer.id}`} className="focus-ring -m-2 flex items-center gap-3 rounded p-2 hover:bg-page">
              <span className="flex h-9 w-9 items-center justify-center rounded bg-accent-50 text-accent-700" aria-hidden="true">
                <Building2 className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium text-ink">{order.customer.name}</span>
                <span className="block text-xs text-accent-700">Open customer 360</span>
              </span>
            </Link>
          </SectionCard>
          <StatusControl order={order} />
          <ProgressCard order={order} showActors />
          <DeliveryCard order={order} />
        </div>
        <div className="min-w-0 space-y-6">
          <ItemsCard order={order} />
          <Card className="p-5">
            <Tabs
              label="Order activity"
              value={tab}
              onChange={setTab}
              items={[
                { id: "conversation", label: "Conversation", count: order.counts.messages, content: <ConversationTab orderId={order.id} viewer="ops" /> },
                { id: "issues", label: "Issues", count: order.counts.issues, content: <IssuesTab orderId={order.id} viewer="ops" /> },
                { id: "attachments", label: "Attachments", count: order.counts.attachments, content: <AttachmentsTab orderId={order.id} canUpload={false} /> },
                { id: "feedback", label: "Feedback", content: <FeedbackTab order={order} readOnly /> },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
