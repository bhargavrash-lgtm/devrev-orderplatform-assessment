import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Product } from "../api";

/** The backend accepts 1–1000 of a product per order line (OrderItemIn) and at most 100 lines. */
export const MAX_LINE_QUANTITY = 1000;
export const MAX_LINES = 100;

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  /** Total number of units, shown on the cart button. */
  count: number;
  subtotal: number;
  /** A stable string that changes whenever what's in the cart changes. */
  signature: string;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function maxQuantityFor(product: Product): number {
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, product.stock));
}

/**
 * The cart lives in React state only, never in browser storage, so it resets on a full page
 * refresh by design. Prices shown here are a preview: the order uses the price at the moment it is placed.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setOpen] = useState(false);

  const add = useCallback((product: Product, quantity = 1) => {
    setLines((current) => {
      const max = maxQuantityFor(product);
      if (max === 0) return current;
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) => line.product.id === product.id
          ? { product, quantity: Math.min(max, line.quantity + quantity) }
          : line);
      }
      if (current.length >= MAX_LINES) return current;
      return [...current, { product, quantity: Math.min(max, Math.max(1, quantity)) }];
    });
  }, []);

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setLines((current) => current.map((line) => line.product.id === productId
      ? { ...line, quantity: Math.min(maxQuantityFor(line.product), Math.max(1, quantity)) }
      : line));
  }, []);

  const remove = useCallback((productId: number) => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<CartContextValue>(() => ({
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: lines.reduce((sum, line) => sum + line.quantity * line.product.unit_price, 0),
    signature: lines.map((line) => `${line.product.id}x${line.quantity}`).join(","),
    add, setQuantity, remove, clear, isOpen, open, close,
  }), [lines, add, setQuantity, remove, clear, isOpen, open, close]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
