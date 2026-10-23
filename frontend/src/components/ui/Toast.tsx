import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../../lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastItem extends Required<Omit<ToastInput, "description">> {
  id: number;
  description?: string;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const iconColor = { success: "text-green-dot", error: "text-red-dot", info: "text-accent-500" };
const DISMISS_MS = 5000;

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = icons[toast.tone];
  const timer = useRef<number | undefined>(undefined);
  const start = useCallback(() => {
    timer.current = window.setTimeout(() => onDismiss(toast.id), DISMISS_MS);
  }, [onDismiss, toast.id]);
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => {
    start();
    return stop;
  }, [start]);

  return (
    <li
      // Errors interrupt; everything else waits its turn.
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
      className="pointer-events-auto flex w-full animate-slide-up items-start gap-3 rounded-card border border-line bg-white p-4 shadow-raised"
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconColor[toast.tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-ink-subtle">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="focus-ring -m-1 rounded p-1 text-ink-faint hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((input: ToastInput) => {
    const toast: ToastItem = { id: nextId.current++, tone: input.tone ?? "info", title: input.title, description: input.description };
    setToasts((all) => [...all.slice(-3), toast]);
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section aria-label="Notifications" className="pointer-events-none fixed bottom-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-sm">
        <ol className="flex flex-col gap-2">
          {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
