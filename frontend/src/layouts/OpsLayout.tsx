import { useState } from "react";
import { CircleAlert, LayoutDashboard, LogOut, Menu as MenuIcon, Package, Users } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { Logo } from "../components/brand/Logo";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Avatar, Badge, Button, Drawer, IconButton } from "../components/ui";
import { cn } from "../lib/cn";

const SECTIONS = [
  { to: "/ops", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/ops/orders", label: "Orders", icon: Package, end: false },
  { to: "/ops/issues", label: "Issues", icon: CircleAlert, end: false },
  { to: "/ops/customers", label: "Customers", icon: Users, end: false },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Ops sections">
      <ul className="space-y-1">
        {SECTIONS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) => cn(
                "focus-ring flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-accent-50 text-accent-700" : "text-ink-muted hover:bg-line-soft hover:text-ink",
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function OpsLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen lg:pl-sidebar">
      <a href="#main" className="focus-ring sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-sidebar flex-col border-r border-line bg-white lg:flex">
        <div className="flex h-topbar items-center px-5">
          <Link to="/ops" className="focus-ring rounded" aria-label="OrderWave ops home">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 px-3 py-4">
          <p className="mb-2 px-3 text-2xs font-semibold uppercase text-ink-faint">Back office</p>
          <SidebarNav />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-gutter">
        <IconButton label="Open navigation" className="lg:hidden" onClick={() => setNavOpen(true)}>
          <MenuIcon className="h-5 w-5" aria-hidden="true" />
        </IconButton>
        <Link to="/ops" className="focus-ring rounded lg:hidden" aria-label="OrderWave ops home">
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2.5 sm:flex">
            <Avatar name={user.full_name} size="sm" decorative />
            <span className="text-sm font-medium text-ink">{user.full_name}</span>
            <Badge tone="accent">Ops</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()} icon={<LogOut className="h-4 w-4" aria-hidden="true" />}>
            Sign out
          </Button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-content px-4 py-page sm:px-gutter">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Navigation" width="sm">
        <SidebarNav onNavigate={() => setNavOpen(false)} />
        <div className="mt-6 flex items-center gap-2.5 border-t border-line-soft pt-5 sm:hidden">
          <Avatar name={user.full_name} size="sm" decorative />
          <span className="text-sm font-medium text-ink">{user.full_name}</span>
          <Badge tone="accent">Ops</Badge>
        </div>
      </Drawer>
    </div>
  );
}
