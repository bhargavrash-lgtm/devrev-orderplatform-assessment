import { useId, useState, type KeyboardEvent } from "react";
import { Minus, Plus, Star } from "lucide-react";
import { cn } from "../../lib/cn";

interface QuantityStepperProps {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  /** Names what is being counted, e.g. the product, for screen readers. */
  label: string;
  size?: "sm" | "md";
}

/** − [n] + with a typeable number in the middle, clamped to [min, max]. */
export function QuantityStepper({ value, min = 1, max, onChange, label, size = "md" }: QuantityStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed));
    setDraft(null);
  };
  const box = size === "sm" ? "h-8" : "h-9";
  const button = cn(
    "focus-ring flex w-8 items-center justify-center text-ink-muted transition-colors hover:bg-line-soft hover:text-ink",
    "disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent",
  );
  return (
    <div role="group" aria-label={`Quantity for ${label}`} className={cn("inline-flex items-stretch overflow-hidden rounded border border-line-strong bg-white", box)}>
      <button type="button" className={button} onClick={() => onChange(clamp(value - 1))} disabled={value <= min}
        aria-label={`Decrease quantity of ${label}`}>
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        aria-label={`Quantity of ${label}`}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
        className="w-12 border-x border-line text-center text-sm tabular-nums text-ink outline-none focus-visible:bg-accent-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" className={button} onClick={() => onChange(clamp(value + 1))} disabled={value >= max}
        aria-label={`Increase quantity of ${label}`}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Read-only stars, e.g. a review's rating or an average. */
export function Stars({ value, size = "sm", label }: { value: number; size?: "sm" | "md"; label?: string }) {
  const rounded = Math.round(value);
  return (
    <span role="img" aria-label={label ?? `${value} out of 5 stars`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5", n <= rounded ? "fill-amber-dot text-amber-dot" : "fill-line text-line")}
        />
      ))}
    </span>
  );
}

/** Pick 1–5 stars. A radio group: arrow keys change the rating, like any radio group. */
export function StarRatingInput({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const name = useId();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); onChange(Math.min(5, value + 1)); }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); onChange(Math.max(1, value - 1)); }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex items-center gap-1" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            className="peer sr-only"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          />
          <Star
            aria-hidden="true"
            className={cn(
              "h-7 w-7 rounded transition-colors peer-focus-visible:shadow-focus",
              n <= shown ? "fill-amber-dot text-amber-dot" : "fill-line-soft text-line-strong",
            )}
          />
        </label>
      ))}
      <span className="ml-2 text-sm text-ink-subtle" aria-hidden="true">{value ? `${value} of 5` : "Not rated"}</span>
    </div>
  );
}
