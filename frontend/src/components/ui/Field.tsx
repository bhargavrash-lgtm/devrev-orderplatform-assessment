import {
  forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

interface FieldProps {
  label: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
}

const control =
  "block w-full rounded border bg-white text-sm text-ink shadow-xs transition-colors placeholder:text-ink-faint " +
  "focus-visible:border-accent-500 focus-visible:shadow-focus outline-none disabled:bg-page disabled:text-ink-faint";

function controlBorder(error?: string | null) {
  return error ? "border-red-dot" : "border-line-strong hover:border-ink-faint";
}

function useFieldIds(id?: string) {
  const generated = useId();
  const fieldId = id ?? generated;
  return { fieldId, hintId: `${fieldId}-hint`, errorId: `${fieldId}-error` };
}

function FieldShell({ label, hideLabel, hint, error, fieldId, hintId, errorId, children }:
  FieldProps & { fieldId: string; hintId: string; errorId: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className={cn("block text-sm font-medium text-ink", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {hint && !error && <p id={hintId} className="text-xs text-ink-subtle">{hint}</p>}
      {error && <p id={errorId} className="text-xs font-medium text-red-fg">{error}</p>}
    </div>
  );
}

function describedBy(props: { hint?: ReactNode; error?: string | null }, hintId: string, errorId: string, extra?: string) {
  return [props.error ? errorId : props.hint ? hintId : null, extra].filter(Boolean).join(" ") || undefined;
}

export interface InputProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Content inside the right edge of the input, e.g. a show-password button. */
  trailing?: ReactNode;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel, hint, error, trailing, leading, id, className, ...rest },
  ref,
) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldShell {...{ label, hideLabel, hint, error, fieldId, hintId, errorId }}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-subtle">{leading}</span>}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ hint, error }, hintId, errorId, rest["aria-describedby"])}
          className={cn(control, controlBorder(error), "h-10 px-3", leading ? "pl-9" : null, trailing ? "pr-11" : null, className)}
          {...rest}
        />
        {trailing && <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>}
      </div>
    </FieldShell>
  );
});

export interface TextareaProps extends FieldProps, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hideLabel, hint, error, id, className, rows = 4, ...rest },
  ref,
) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldShell {...{ label, hideLabel, hint, error, fieldId, hintId, errorId }}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ hint, error }, hintId, errorId)}
        className={cn(control, controlBorder(error), "resize-y px-3 py-2 leading-relaxed", className)}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectProps extends FieldProps, SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  /** Shown as the first, empty option. */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, hint, error, id, className, options, placeholder, ...rest },
  ref,
) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldShell {...{ label, hideLabel, hint, error, fieldId, hintId, errorId }}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ hint, error }, hintId, errorId)}
          className={cn(control, controlBorder(error), "h-10 appearance-none pl-3 pr-9", className)}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      </div>
    </FieldShell>
  );
});
