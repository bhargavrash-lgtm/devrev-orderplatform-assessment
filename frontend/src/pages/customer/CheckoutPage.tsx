import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPin, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import { customers, orders, type ClientNetwork, type Order } from "../../api";
import { useCart } from "../../cart/CartContext";
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, Select, Skeleton, Textarea,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDateTime, formatInr } from "../../lib/format";

const MAX_NOTE = 500; // OrderCreate.delivery_note max_length
const REQUEST_TIMEOUT_MS = 30_000;

// orders.client_network: the connection the app had when the order was placed.
const NETWORK_OPTIONS: Array<{ value: ClientNetwork; label: string }> = [
  { value: "good", label: "Good signal" },
  { value: "weak", label: "Weak signal" },
  { value: "offline_sync", label: "Offline, synced later" },
];

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const buttonLink =
  "focus-ring inline-flex h-10 items-center rounded px-4 text-sm font-medium shadow-xs transition-colors";

function Confirmation({ order }: { order: Order }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-bg text-green-fg" aria-hidden="true">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold text-ink">Order #{order.id} is placed</h1>
        <p className="mt-1.5 text-sm text-ink-subtle">
          {formatDateTime(order.created_at)} · we'll confirm it shortly. You can follow it and talk to us on the order page.
        </p>
        <ul className="mt-6 divide-y divide-line-soft rounded-card border border-line text-left" aria-label="Items ordered">
          {order.items.map((item) => (
            <li key={item.product_id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-ink">{item.name} <span className="text-ink-subtle">× {item.quantity}</span></span>
              <span className="tabular-nums text-ink">{formatInr(item.quantity * item.unit_price)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums" data-testid="confirmation-total">{formatInr(order.total)}</span>
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={`/orders/${order.id}`} className={cn(buttonLink, "bg-accent-600 text-white hover:bg-accent-700")}>View order #{order.id}</Link>
          <Link to="/shop" className={cn(buttonLink, "border border-line-strong bg-white text-ink hover:bg-page")}>Continue shopping</Link>
        </div>
      </Card>
    </div>
  );
}

export function CheckoutPage() {
  const cart = useCart();
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: ["customer", "mine"], queryFn: customers.mine, staleTime: 5 * 60_000 });

  const [addressId, setAddressId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [network, setNetwork] = useState<ClientNetwork>("good");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  // One key per checkout attempt. A retry after a failure reuses it, so the backend can never
  // create the order twice; it changes only after a successful order or when the cart changes.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const keyedSignature = useRef(cart.signature);
  useEffect(() => {
    if (cart.signature !== keyedSignature.current) {
      keyedSignature.current = cart.signature;
      setIdempotencyKey(newIdempotencyKey());
    }
  }, [cart.signature]);

  // Blocks a second submit synchronously, before React has re-rendered the disabled button.
  const inFlight = useRef(false);

  const addresses = company.data?.addresses ?? [];
  const selectedAddress = addressId ?? addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? null;

  if (placed) return <Confirmation order={placed} />;

  if (cart.lines.length === 0) {
    return (
      <>
        <PageHeader title="Checkout" />
        <Card>
          <EmptyState icon={<ShoppingBag className="h-6 w-6" />} title="Your cart is empty"
            description="Add products from the shop, then come back here to place the order."
            action={<Link to="/shop" className={cn(buttonLink, "bg-accent-600 text-white hover:bg-accent-700")}>Go to the shop</Link>} />
        </Card>
      </>
    );
  }

  const placeOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
      const order = await orders.create({
        items: cart.lines.map((line) => ({ product_id: line.product.id, quantity: line.quantity })),
        delivery_note: note.trim() || null,
        address_id: selectedAddress,
        client_network: network,
      }, idempotencyKey, signal);
      setPlaced(order);
      cart.clear();
      setIdempotencyKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] }); // stock changed
      window.scrollTo?.({ top: 0 });
    } catch (err) {
      // Keep the same key: if the first request did reach the server, the retry returns that order.
      setError(err instanceof Error ? err.message : "Couldn't place the order. Please try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Checkout" description="Check the order, choose where it goes, and place it." />
      <form onSubmit={placeOrder} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <SectionCard title="Delivery address">
            {company.isPending ? (
              <LoadingState label="Loading addresses" className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-24" /><Skeleton className="h-24" />
              </LoadingState>
            ) : company.isError ? (
              <ErrorState title="Couldn't load your addresses" message={company.error.message} onRetry={() => void company.refetch()} className="py-6" />
            ) : addresses.length === 0 ? (
              <EmptyState icon={<MapPin className="h-6 w-6" />} title="No saved addresses"
                description="The order will go to your company's default delivery address." className="py-6" />
            ) : (
              <fieldset>
                <legend className="sr-only">Delivery address</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {addresses.map((address) => {
                    const checked = selectedAddress === address.id;
                    return (
                      <label key={address.id}
                        className={cn(
                          "relative flex cursor-pointer gap-3 rounded-card border p-4 transition-colors has-[:focus-visible]:shadow-focus",
                          checked ? "border-accent-500 bg-accent-50/60" : "border-line hover:border-line-strong",
                        )}>
                        <input type="radio" name="address" value={address.id} checked={checked}
                          onChange={() => setAddressId(address.id)} className="mt-1 h-4 w-4 accent-accent-600" />
                        <span className="min-w-0 text-sm">
                          <span className="flex items-center gap-2 font-medium text-ink">
                            {address.label}
                            {address.is_default && <Badge tone="neutral">Default</Badge>}
                          </span>
                          <span className="mt-1 block text-ink-muted">{address.line1}</span>
                          <span className="block text-ink-muted">{[address.city, address.state, address.pincode].filter(Boolean).join(", ")}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </SectionCard>

          <SectionCard title="Delivery details">
            <div className="space-y-5">
              <Textarea label="Delivery note (optional)" rows={3} maxLength={MAX_NOTE} value={note}
                onChange={(e) => setNote(e.target.value)} placeholder="For example: call the store keeper before arrival"
                hint={`${note.length} / ${MAX_NOTE}`} />
              <Select label="Connection when ordering" options={NETWORK_OPTIONS} value={network}
                onChange={(e) => setNetwork(e.target.value as ClientNetwork)}
                hint="Simulates a field rep placing the order on poor mobile coverage. It's saved with the order." />
            </div>
          </SectionCard>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionCard title="Order summary" actions={<Button variant="ghost" size="sm" onClick={cart.open}>Edit cart</Button>}>
            <ul className="divide-y divide-line-soft" aria-label="Items in this order">
              {cart.lines.map(({ product, quantity }) => (
                <li key={product.id} className="flex justify-between gap-3 py-2.5 text-sm first:pt-0">
                  <span className="min-w-0 text-ink">{product.name} <span className="text-ink-subtle">× {quantity}</span></span>
                  <span className="shrink-0 tabular-nums text-ink">{formatInr(quantity * product.unit_price)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-sm font-medium text-ink">Total</span>
              <span className="text-xl font-semibold tabular-nums text-ink" data-testid="checkout-total">{formatInr(cart.subtotal)}</span>
            </div>
            <p className="mt-1 text-xs text-ink-subtle">Prices are taken when the order is placed.</p>
            {error && (
              <p role="alert" className="mt-4 rounded border border-red-dot/30 bg-red-bg px-3 py-2.5 text-sm text-red-fg">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" fullWidth className="mt-4" loading={submitting} loadingLabel="Placing order">
              {error ? "Try again" : "Place order"}
            </Button>
          </SectionCard>
        </div>
      </form>
    </>
  );
}
