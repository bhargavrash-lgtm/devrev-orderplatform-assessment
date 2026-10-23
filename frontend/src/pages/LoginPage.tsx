import { useRef, useState, type FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, MessagesSquare, PackageCheck, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { homeFor, useAuth } from "../auth/AuthContext";
import { Logo } from "../components/brand/Logo";
import { Button, IconButton, Input } from "../components/ui";

const DEMO_ACCOUNTS = [
  { email: "sundaram@orderwave.demo", label: "Sundaram Agro", role: "Customer" },
  { email: "greenfield@orderwave.demo", label: "Greenfield Co-op", role: "Customer" },
  { email: "ops@orderwave.demo", label: "Ops", role: "Ops" },
  { email: "accounts@orderwave.demo", label: "Accounts", role: "Ops" },
];

const FEATURES = [
  { icon: PackageCheck, text: "Order seeds, fertiliser and equipment in a few taps" },
  { icon: Truck, text: "Follow every order from placed to delivered" },
  { icon: MessagesSquare, text: "Raise a problem and talk it through on the order" },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      navigate(homeFor(user), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-accent-900 px-12 py-14 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent-700/40" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-accent-800/50" />
        <Logo inverted className="relative" />
        <div className="relative mt-auto max-w-md">
          <p className="text-3xl font-semibold leading-tight">Every order, every conversation, in one calm place.</p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3.5 text-base text-accent-100">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10" aria-hidden="true">
                  <Icon className="h-4 w-4 text-white" />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-16 text-xs text-accent-200">Demo data for a take-home assessment. All companies and people are fictional.</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-form">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-subtle">Use your OrderWave account to continue.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate aria-describedby={error ? "login-error" : undefined}>
            <Input
              label="Email"
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <Input
              ref={passwordRef}
              label="Password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              trailing={
                <IconButton
                  label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="h-8 w-8"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </IconButton>
              }
            />

            {error && (
              <div id="login-error" role="alert" className="flex items-start gap-2.5 rounded border border-red-dot/30 bg-red-bg px-3.5 py-3 text-sm text-red-fg">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" size="lg" fullWidth loading={submitting} loadingLabel="Signing in" disabled={!email || !password}>
              Sign in
            </Button>
          </form>

          <div className="mt-10 border-t border-line pt-6">
            <p id="demo-accounts-label" className="text-2xs font-semibold uppercase text-ink-subtle">Demo accounts</p>
            <p className="mt-1 text-xs text-ink-subtle">Fills in the email only. Use the demo password you were given.</p>
            <div role="group" aria-labelledby="demo-accounts-label" className="mt-3 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setError(null);
                    passwordRef.current?.focus();
                  }}
                  aria-label={`Use ${account.email} (${account.role})`}
                  title={account.email}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-muted shadow-xs transition-colors hover:border-accent-300 hover:text-accent-700"
                >
                  {account.label}
                  <span className="text-ink-faint">· {account.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
