import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Search, ShoppingBag, Store } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { customers } from "../api";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { Logo } from "../components/brand/Logo";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Avatar, Drawer, EmptyState, IconButton, Menu, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

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

export function CustomerLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
  const [cartOpen, setCartOpen] = useState(false);
  const company = useQuery({ queryKey: ["customer", "mine"], queryFn: customers.mine, staleTime: 5 * 60_000 });
  const cartCount = 0; // the cart arrives in the next build step

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

          <form role="search" aria-label="Products" className="ml-auto hidden max-w-xs flex-1 sm:block" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="product-search" className="sr-only">Search products</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input
                id="product-search"
                type="search"
                placeholder="Search products"
                className="h-9 w-full rounded-full border border-line bg-page pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus-visible:border-accent-500 focus-visible:bg-white focus-visible:shadow-focus"
              />
            </div>
          </form>

          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <IconButton label={`Cart, ${cartCount} items`} onClick={() => setCartOpen(true)}>
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-2xs font-semibold text-white"
              >
                {cartCount}
              </span>
            </IconButton>
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

      <Drawer open={cartOpen} onClose={() => setCartOpen(false)} title="Your cart" description={`${cartCount} items`}>
        <EmptyState
          icon={<Store className="h-6 w-6" />}
          title="Your cart is empty"
          description="Products you add from the shop will show up here, ready to order."
          action={
            <Link
              to="/shop"
              onClick={() => setCartOpen(false)}
              className="focus-ring inline-flex h-9 items-center rounded bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
            >
              Browse the shop
            </Link>
          }
        />
      </Drawer>
    </div>
  );
}
