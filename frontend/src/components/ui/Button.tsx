import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent-600 text-white shadow-xs hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-300",
  secondary: "border border-line-strong bg-white text-ink shadow-xs hover:bg-page active:bg-line-soft disabled:text-ink-faint",
  ghost: "text-ink-muted hover:bg-line-soft hover:text-ink active:bg-line disabled:text-ink-faint",
  danger: "bg-red-solid text-white shadow-xs hover:bg-red-hover disabled:opacity-60",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded px-3 text-sm",
  md: "h-10 gap-2 rounded px-4 text-sm",
  lg: "h-11 gap-2 rounded-md px-5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Read out instead of the label while loading, e.g. "Signing in". */
  loadingLabel?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, loadingLabel, icon, fullWidth, className, children, disabled, type,
    ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "focus-ring inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors",
        "disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {loading && loadingLabel ? <span>{loadingLabel}</span> : children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  variant?: "ghost" | "secondary";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring relative inline-flex h-9 w-9 items-center justify-center rounded text-ink-muted transition-colors",
        variant === "ghost" ? "hover:bg-line-soft hover:text-ink" : "border border-line-strong bg-white hover:bg-page",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
