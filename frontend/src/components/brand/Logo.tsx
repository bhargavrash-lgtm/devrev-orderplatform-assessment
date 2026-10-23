import { cn } from "../../lib/cn";

/** OrderWave mark: a rounded tile with a wave line and a small dot, plus the wordmark. */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className={inverted ? "fill-white" : "fill-accent-600"} />
      <path
        d="M7 19c2.5 0 3.5-5 6-5s3.5 5 6 5 3.5-5 6-5"
        fill="none"
        className={inverted ? "stroke-accent-600" : "stroke-white"}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25" cy="10" r="2" className={inverted ? "fill-accent-300" : "fill-accent-200"} />
    </svg>
  );
}

export function Logo({ className, inverted = false, label = "OrderWave" }: { className?: string; inverted?: boolean; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark inverted={inverted} />
      <span className={cn("text-lg font-semibold tracking-tight", inverted ? "text-white" : "text-ink")}>
        {label === "OrderWave" ? (<>Order<span className={inverted ? "text-accent-200" : "text-accent-600"}>Wave</span></>) : label}
      </span>
    </span>
  );
}
