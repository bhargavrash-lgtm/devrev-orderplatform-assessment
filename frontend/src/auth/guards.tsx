import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "../api";
import { Logo } from "../components/brand/Logo";
import { LoadingState, Skeleton } from "../components/ui";
import { homeFor, useAuth } from "./AuthContext";

function SessionLoading() {
  return (
    <LoadingState label="Checking your session" className="flex min-h-screen flex-col items-center justify-center gap-5">
      <Logo />
      <Skeleton className="h-1.5 w-40 rounded-full" />
    </LoadingState>
  );
}

/**
 * Logged-out users go to /login. A signed-in user of the wrong role goes to their own home
 * (/shop for customers, /ops for ops), so neither side can open the other's pages.
 */
export function RequireRole({ role }: { role: Role }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <SessionLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

/** "/" sends people to the right place. */
export function RootRedirect() {
  const { user, status } = useAuth();
  if (status === "loading") return <SessionLoading />;
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

/** The login page is only for logged-out users. */
export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  if (status === "loading") return <SessionLoading />;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
