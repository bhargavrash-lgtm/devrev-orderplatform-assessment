import { ShoppingBag, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Drawer, EmptyState, IconButton, QuantityStepper } from "../components/ui";
import { formatInr } from "../lib/format";
import { maxQuantityFor, useCart } from "./CartContext";

export function CartDrawer() {
  const cart = useCart();
  return (
    <Drawer
      open={cart.isOpen}
      onClose={cart.close}
      title="Your cart"
      description={`${cart.count} ${cart.count === 1 ? "item" : "items"}`}
      footer={cart.lines.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Subtotal</span>
            <span className="text-lg font-semibold tabular-nums text-ink" data-testid="cart-subtotal">{formatInr(cart.subtotal)}</span>
          </div>
          <p className="text-xs text-ink-subtle">Prices are confirmed when you place the order.</p>
          <Link
            to="/checkout"
            onClick={cart.close}
            className="focus-ring flex h-11 w-full items-center justify-center rounded-md bg-accent-600 text-base font-medium text-white shadow-xs hover:bg-accent-700"
          >
            Proceed to checkout
          </Link>
        </div>
      ) : undefined}
    >
      {cart.lines.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Your cart is empty"
          description="Add products from the shop and they'll show up here, ready to order."
          action={
            <Link to="/shop" onClick={cart.close}
              className="focus-ring inline-flex h-9 items-center rounded bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700">
              Browse the shop
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line-soft" aria-label="Items in your cart">
          {cart.lines.map(({ product, quantity }) => (
            <li key={product.id} className="flex gap-4 py-4 first:pt-0">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-line bg-page">
                {product.image_url && <img src={product.image_url} alt="" className="h-full w-full object-contain p-1.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{product.name}</p>
                  <IconButton label={`Remove ${product.name}`} onClick={() => cart.remove(product.id)} className="-mr-2 -mt-1 h-8 w-8">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <p className="text-xs text-ink-subtle">{formatInr(product.unit_price)} each</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <QuantityStepper size="sm" label={product.name} value={quantity} max={maxQuantityFor(product)}
                    onChange={(n) => cart.setQuantity(product.id, n)} />
                  <span className="text-sm font-medium tabular-nums text-ink">{formatInr(quantity * product.unit_price)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
