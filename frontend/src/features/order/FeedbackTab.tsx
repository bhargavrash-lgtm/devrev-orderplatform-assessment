import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { orders, type Order } from "../../api";
import {
  Button, EmptyState, ErrorState, LoadingState, PlainText, Skeleton, StarRatingInput, Stars, Textarea,
} from "../../components/ui";
import { formatDateTime, humanize } from "../../lib/format";

const MAX_COMMENT = 1000; // FeedbackIn.comment max_length

export function FeedbackTab({ order, readOnly = false }: { order: Order; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const feedback = useQuery({
    queryKey: ["order", order.id, "feedback"],
    queryFn: () => orders.feedback(order.id),
    enabled: order.has_feedback,
  });
  const submit = useMutation({
    mutationFn: () => orders.leaveFeedback(order.id, { rating, comment: comment.trim() || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["order", order.id, "feedback"] });
      void queryClient.invalidateQueries({ queryKey: ["order", order.id], exact: true });
    },
    onError: (err) => setError(err.message),
  });

  if (readOnly && !order.has_feedback) {
    return (
      <EmptyState icon={<Star className="h-6 w-6" />} title="No feedback yet"
        description={order.order_status === "delivered" ? "The customer hasn't rated this order." : "Customers can rate an order once it's delivered."} className="py-10" />
    );
  }

  if (!readOnly && order.order_status !== "delivered") {
    return (
      <EmptyState icon={<Star className="h-6 w-6" />} title="Feedback opens after delivery"
        description={`This order is ${humanize(order.order_status).toLowerCase()}. Once it's delivered you can rate it here.`} className="py-10" />
    );
  }

  if (order.has_feedback) {
    if (feedback.isPending) {
      return <LoadingState label="Loading your feedback"><Skeleton className="h-24 w-full" /></LoadingState>;
    }
    if (feedback.isError) {
      return <ErrorState title="Couldn't load your feedback" message={feedback.error.message} onRetry={() => void feedback.refetch()} />;
    }
    return (
      <div className="rounded-card border border-line p-5">
        <p className="text-sm font-medium text-ink">{readOnly ? "Customer feedback" : "Your feedback"}</p>
        <div className="mt-2 flex items-center gap-2">
          <Stars value={feedback.data.rating} size="md" />
          <span className="text-sm text-ink-muted">{feedback.data.rating} of 5</span>
        </div>
        {feedback.data.comment && <PlainText text={feedback.data.comment} className="mt-3 text-sm text-ink" />}
        <p className="mt-3 text-xs text-ink-subtle">Sent {formatDateTime(feedback.data.created_at)}{readOnly ? "" : " · thank you"}</p>
      </div>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    setError(null);
    submit.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-prose space-y-4">
      <div>
        <p className="text-sm font-medium text-ink">How did this order go?</p>
        <p className="mb-2 text-xs text-ink-subtle">One rating per order. It helps us fix what went wrong.</p>
        <StarRatingInput label="Order rating" value={rating} onChange={setRating} />
      </div>
      <Textarea label="Comment (optional)" rows={4} maxLength={MAX_COMMENT} value={comment}
        onChange={(e) => setComment(e.target.value)} hint={`${comment.length} / ${MAX_COMMENT}`} />
      {error && <p role="alert" className="text-sm font-medium text-red-fg">{error}</p>}
      <Button type="submit" loading={submit.isPending} loadingLabel="Sending">Send feedback</Button>
    </form>
  );
}
