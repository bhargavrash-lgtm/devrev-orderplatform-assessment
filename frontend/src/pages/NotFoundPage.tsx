import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { homeFor, useAuth } from "../auth/AuthContext";
import { Logo } from "../components/brand/Logo";

export function NotFoundPage() {
  const { user } = useAuth();
  const home = user ? homeFor(user) : "/login";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-12" />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600" aria-hidden="true">
        <Compass className="h-6 w-6" />
      </div>
      <p className="mt-6 text-sm font-semibold text-accent-600">404</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">We couldn't find that page</h1>
      <p className="mt-2 max-w-sm text-base text-ink-subtle">The link may be old, or the page may have moved.</p>
      <Link
        to={home}
        className="focus-ring mt-8 inline-flex h-10 items-center rounded bg-accent-600 px-4 text-sm font-medium text-white shadow-xs hover:bg-accent-700"
      >
        {user ? "Back to OrderWave" : "Go to sign in"}
      </Link>
    </main>
  );
}
