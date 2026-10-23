import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Search, ShoppingBag } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { customers } from "../api";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { CartProvider, useCart } from "../cart/CartContext";
import { CartDrawer } from "../cart/CartDrawer";
import { Logo } from "../components/brand/Logo";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Avatar, IconButton, Menu, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";
import { useDebouncedValue } from "../lib/hooks";

const NAV = [
  { to: "/shop", label: "Shop" },
  { to: "/orders", label: "My orders" },
];

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "focus-ring rounded px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-accent-50 text-accent-700" : "text-ink-muted hover:bg-line-soft hover:text-ink",
  );
}

/** Top-bar search: typing (debounced) opens /shop?q=..., keeping the shop's other filters. */
function ProductSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const onShop = location.pathname === "/shop";
  const urlTerm = onShop ? params.get("q") ?? "" : "";
  const [term, setTerm] = useState(urlTerm);
  const typed = useRef(false);
  const debounced = useDebouncedValue(term, 300);

  // Follow the URL (back button, "clear filters") unless the user is mid-typing.
  useEffect(() => {
    if (!typed.current) setTerm(urlTerm);
  }, [urlTerm]);

  useEffect(() => {
    if (!typed.current) return;
    typed.current = false;
    const next = new URLSearchParams(onShop ? params : undefined);
    if (debounced.trim()) next.set("q", debounced.trim());
    else next.delete("q");
    next.delete("page");
    navigate({ pathname: "/shop", search: next.toString() }, { replace: onShop });
    // Deliberately runs only when the debounced term changes, not on every URL change.
  }, [debounced]);

  return (
    <form role="search" aria-label="Products" className="ml-auto hidden max-w-xs flex-1 sm:block" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="product-search" className="sr-only">Search products</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          id="product-search"
          type="search"
          placeholder="Search products"
          value={term}
          maxLength={100}
          onChange={(e) => { typed.current = true; setTerm(e.target.value); }}
          className="h-9 w-full rounded-full border border-line bg-page pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus-visible:border-accent-500 focus-visible:bg-white focus-visible:shadow-focus"
        />
      </div>
    </form>
  );
}

function CartButton() {
  const cart = useCart();
  return (
    <IconButton label={`Cart, ${cart.count} ${cart.count === 1 ? "item" : "items"}`} onClick={cart.open}>
      <ShoppingBag className="h-5 w-5" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs font-semibold",
          cart.count > 0 ? "bg-accent-600 text-white" : "bg-line text-ink-subtle",
        )}
      >
        {cart.count > 99 ? "99+" : cart.count}
      </span>
    </IconButton>
  );
}

function CustomerShell() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
  const company = useQuery({ queryKey: ["customer", "mine"], queryFn: customers.mine, staleTime: 5 * 60_000 });

  return (
    <div className="min-h-screen">
      <a href="#main" className="focus-ring sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-topbar max-w-content items-center gap-6 px-4 sm:px-gutter">
          <Link to="/shop" className="focus-ring rounded" aria-label="OrderWave home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => <NavLink key={item.to} to={item.to} className={navClass}>{item.label}</NavLink>)}
          </nav>
          <ProductSearch />
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <CartButton />
            <Menu
              label="Account menu"
              trigger={
                <>
                  <Avatar name={user.full_name} size="sm" decorative />
                  <span className="hidden text-sm font-medium text-ink lg:inline">{user.full_name}</span>
                </>
              }
              header={
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{user.full_name}</p>
                  {company.isPending ? (
                    <Skeleton className="mt-1.5 h-3 w-36" />
                  ) : company.data ? (
                    <p className="truncate text-xs text-ink-subtle">{company.data.name}</p>
                  ) : null}
                </div>
              }
              items={[{ label: "Sign out", icon: <LogOut className="h-4 w-4" aria-hidden="true" />, onSelect: () => void logout() }]}
            />
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 border-t border-line-soft px-4 py-2 md:hidden">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} className={navClass}>{item.label}</NavLink>)}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-content px-4 py-page sm:px-gutter">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CartDrawer />
    </div>
  );
}

/** The cart is shared by every customer page, and only exists while the app is open. */
export function CustomerLayout() {
  return (
    <CartProvider>
      <CustomerShell />
    </CartProvider>
  );
}
