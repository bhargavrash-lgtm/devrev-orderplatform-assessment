import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Plus } from "lucide-react";
import { orders, products, type Product } from "../../api";
import { maxQuantityFor, useCart } from "../../cart/CartContext";
import {
  Button, Drawer, EmptyState, ErrorState, LoadingState, Pagination, PlainText, QuantityStepper, Select, Skeleton,
  StarRatingInput, Stars, Textarea, useToast,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDate, formatInr } from "../../lib/format";
import { stockLabel } from "./stock";

const REVIEW_PAGE_SIZE = 10;
const MAX_COMMENT = 1000; // ReviewIn.comment max_length

function ReviewForm({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [orderId, setOrderId] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A review needs one of this customer's delivered orders that contains the product.
  const eligible = useQuery({
    queryKey: ["orders", { status: "delivered", product: product.sku, page_size: 100 }],
    queryFn: () => orders.list({ status: "delivered", product: product.sku, page_size: 100 }),
  });
  const submit = useMutation({
    mutationFn: () => products.addReview(product.id, { order_id: Number(orderId), rating, comment: comment.trim() || null }),
    onSuccess: () => {
      setRating(0);
      setComment("");
      setError(null);
      toast({ tone: "success", title: "Thanks for your review" });
      void queryClient.invalidateQueries({ queryKey: ["reviews", product.id] });
    },
    onError: (err) => setError(err.message),
  });

  if (eligible.isPending) return <Skeleton className="h-24 w-full" />;
  if (eligible.isError) return <p className="text-sm text-ink-subtle">Couldn't check your orders for this product.</p>;
  const options = eligible.data.items
    .filter((order) => order.items.some((item) => item.product_id === product.id))
    .map((order) => ({ value: String(order.id), label: `Order #${order.id} · ${formatDate(order.created_at)}` }));
  if (options.length === 0) {
    return (
      <p className="rounded border border-line bg-page px-4 py-3 text-sm text-ink-muted">
        You can review this product once an order containing it has been delivered.
      </p>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!orderId) return setError("Choose the order this review is for.");
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    setError(null);
    submit.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-line p-4" noValidate>
      <h4 className="text-sm font-semibold text-ink">Write a review</h4>
      <Select label="Order" options={options} placeholder="Choose an order" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink" id={`rating-${product.id}`}>Rating</p>
        <StarRatingInput label="Rating" value={rating} onChange={setRating} />
      </div>
      <Textarea label="Comment (optional)" rows={3} maxLength={MAX_COMMENT} value={comment} onChange={(e) => setComment(e.target.value)}
        hint={`${comment.length} / ${MAX_COMMENT}`} />
      {error && <p role="alert" className="text-sm font-medium text-red-fg">{error}</p>}
      <Button type="submit" loading={submit.isPending} loadingLabel="Posting">Post review</Button>
    </form>
  );
}

function Reviews({ product }: { product: Product }) {
  const [page, setPage] = useState(1);
  const reviews = useQuery({
    queryKey: ["reviews", product.id, page],
    queryFn: () => products.reviews(product.id, { page, page_size: REVIEW_PAGE_SIZE }),
  });

  return (
    <section aria-labelledby={`reviews-${product.id}`} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 id={`reviews-${product.id}`} className="text-base font-semibold text-ink">Reviews</h3>
        {reviews.data && reviews.data.review_count > 0 && reviews.data.average_rating !== null && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Stars value={reviews.data.average_rating} label={`Average ${reviews.data.average_rating} out of 5`} />
            <span className="font-medium text-ink">{reviews.data.average_rating.toFixed(1)}</span>
            <span>· {reviews.data.review_count} {reviews.data.review_count === 1 ? "review" : "reviews"}</span>
          </div>
        )}
      </div>

      {reviews.isPending ? (
        <LoadingState label="Loading reviews" className="space-y-3">
          {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </LoadingState>
      ) : reviews.isError ? (
        <ErrorState title="Couldn't load reviews" message={reviews.error.message} onRetry={() => void reviews.refetch()} className="py-6" />
      ) : reviews.data.items.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="No reviews yet"
          description="Customers who have received this product can review it." className="py-6" />
      ) : (
        <>
          <ul className="space-y-3" aria-label={`Reviews of ${product.name}`}>
            {reviews.data.items.map((review) => (
              <li key={review.id} className="rounded-card border border-line-soft bg-page/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars value={review.rating} />
                  <span className="text-xs text-ink-subtle">{formatDate(review.created_at)}</span>
                </div>
                {review.comment && <PlainText text={review.comment} className="mt-2 text-sm text-ink" />}
                <p className="mt-2 text-xs font-medium text-ink-muted">{review.customer_name}</p>
              </li>
            ))}
          </ul>
          {reviews.data.total > REVIEW_PAGE_SIZE && (
            <Pagination page={page} pageSize={REVIEW_PAGE_SIZE} total={reviews.data.total} onPageChange={setPage} noun="reviews" />
          )}
        </>
      )}
      <ReviewForm product={product} />
    </section>
  );
}

export function ProductDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const cart = useCart();
  const toast = useToast();
  const [quantity, setQuantity] = useState(1);
  if (!product) return null;
  const max = maxQuantityFor(product);
  const stock = stockLabel(product.stock);
  const inCart = cart.lines.find((line) => line.product.id === product.id)?.quantity ?? 0;
  const room = Math.max(0, max - inCart);

  return (
    <Drawer open onClose={() => { setQuantity(1); onClose(); }} title={product.name} description={`${product.category} · ${product.sku}`}>
      <div className="space-y-6">
        <div className="aspect-[4/3] overflow-hidden rounded-card border border-line bg-page">
          {product.image_url && <img src={product.image_url} alt={`${product.category} product image`} className="h-full w-full object-contain p-10" />}
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-ink">{formatInr(product.unit_price)}</p>
          <p className={cn("text-sm", stock.tone)}>{stock.text}</p>
          {product.description && <PlainText text={product.description} className="mt-3 text-sm leading-relaxed text-ink-muted" />}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-y border-line-soft py-4">
          <QuantityStepper label={product.name} value={Math.min(quantity, Math.max(1, room))} max={Math.max(1, room)} onChange={setQuantity} />
          <Button
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            disabled={room === 0}
            onClick={() => {
              cart.add(product, Math.min(quantity, room));
              toast({ tone: "success", title: "Added to cart", description: product.name });
              setQuantity(1);
            }}
          >
            {room === 0 ? (max === 0 ? "Out of stock" : "Max in cart") : "Add to cart"}
          </Button>
          {inCart > 0 && <span className="text-sm text-ink-subtle">{inCart} in cart</span>}
        </div>
        <Reviews product={product} />
      </div>
    </Drawer>
  );
}
