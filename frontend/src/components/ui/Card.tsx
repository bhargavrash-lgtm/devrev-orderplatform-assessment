import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-card border border-line bg-white shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

interface SectionCardProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding, e.g. for a full-bleed table. */
  flush?: boolean;
}

/** A card with a titled header; the title labels the section for assistive tech. */
export function SectionCard({ title, description, actions, children, className, flush }: SectionCardProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("rounded-card border border-line bg-white shadow-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-subtle">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(!flush && "p-5")}>{children}</div>
    </section>
  );
}

/** Page title block used at the top of every page. */
export function PageHeader({ title, description, actions, eyebrow }:
  { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-section flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-2xs font-semibold uppercase text-ink-subtle">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-prose text-base text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
