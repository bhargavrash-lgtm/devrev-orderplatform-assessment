import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ApiError, orders } from "../../api";
import { Badge, Card, ErrorState, Tabs } from "../../components/ui";
import { AttachmentsTab } from "../../features/order/AttachmentsTab";
import { ConversationTab } from "../../features/order/ConversationTab";
import { FeedbackTab } from "../../features/order/FeedbackTab";
import { IssuesTab } from "../../features/order/IssuesTab";
import { DeliveryCard, ItemsCard, ProgressCard } from "../../features/order/OrderSections";
import { OrderDetailSkeleton, useTab } from "../../features/order/orderPage";
import { formatDateTime, formatInr } from "../../lib/format";
import { NotFoundContent } from "../NotFoundPage";

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const valid = Number.isInteger(orderId) && orderId > 0;
  const [tab, setTab] = useTab();
  const query = useQuery({ queryKey: ["order", orderId], queryFn: () => orders.get(orderId), enabled: valid });

  // Missing and someone else's orders get the same 404 from the API, and the same page here.
  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <Card><NotFoundContent description="This order doesn't exist, or the link is wrong." /></Card>;
  }
  if (query.isPending) return <OrderDetailSkeleton />;
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
          <ProgressCard order={order} />
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
                { id: "conversation", label: "Conversation", count: order.counts.messages, content: <ConversationTab orderId={order.id} viewer="customer" /> },
                { id: "issues", label: "Issues", count: order.counts.issues, content: <IssuesTab orderId={order.id} viewer="customer" /> },
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
