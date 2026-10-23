import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { initials } from "../../lib/format";

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase text-ink-subtle">{label}</p>
        {icon && <span className="text-ink-faint" aria-hidden="true">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-subtle">{hint}</p>}
    </div>
  );
}

export interface TimelineStep {
  id: string;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  state: "done" | "current" | "upcoming" | "cancelled";
}

/** Vertical steps, e.g. an order's progress. The current step is marked with aria-current. */
export function Timeline({ steps, label }: { steps: TimelineStep[]; label: string }) {
  return (
    <ol aria-label={label} className="relative">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.id} aria-current={step.state === "current" ? "step" : undefined} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={cn("absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-px", step.state === "done" ? "bg-accent-300" : "bg-line")}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                step.state === "done" && "border-accent-600 bg-accent-600 text-white",
                step.state === "current" && "border-accent-600 bg-white",
                step.state === "upcoming" && "border-line-strong bg-white",
                step.state === "cancelled" && "border-red-dot bg-red-dot text-white",
              )}
            >
              {step.state === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              {step.state === "current" && <span className="h-2 w-2 rounded-full bg-accent-600" />}
              {step.state === "cancelled" && <X className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-sm font-medium", step.state === "upcoming" ? "text-ink-subtle" : "text-ink")}>
                {step.title}
                <span className="sr-only">{` (${step.state})`}</span>
              </p>
              {step.description && <div className="mt-0.5 text-sm text-ink-muted">{step.description}</div>}
              {step.meta && <div className="mt-0.5 text-xs text-ink-subtle">{step.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const avatarSizes = { sm: "h-7 w-7 text-2xs", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" };

/** Initials avatar. Pass decorative when the name is already shown next to it. */
export function Avatar({ name, size = "md", decorative = false }: { name: string; size?: keyof typeof avatarSizes; decorative?: boolean }) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full bg-accent-100 font-semibold text-accent-800", avatarSizes[size])}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Renders text written by users (messages, descriptions, comments, filenames) as plain text.
 * React escapes it, line breaks are kept, and long words wrap. Never parses HTML.
 */
export function PlainText({ text, className, as: Tag = "p" }: { text: string; className?: string; as?: "p" | "span" | "div" }) {
  return <Tag className={cn("whitespace-pre-wrap break-words", className)}>{text}</Tag>;
}
