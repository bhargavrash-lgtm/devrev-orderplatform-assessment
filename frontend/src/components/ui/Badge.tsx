import type { ReactNode } from "react";
import type { IssueSeverity, OrderStatus, Sentiment } from "../../api/types";
import { cn } from "../../lib/cn";
import { humanize } from "../../lib/format";

export type Tone = "neutral" | "blue" | "amber" | "violet" | "green" | "red" | "accent";

const tones: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: "bg-neutral-bg text-neutral-fg", dot: "bg-neutral-dot" },
  blue: { box: "bg-blue-bg text-blue-fg", dot: "bg-blue-dot" },
  amber: { box: "bg-amber-bg text-amber-fg", dot: "bg-amber-dot" },
  violet: { box: "bg-violet-bg text-violet-fg", dot: "bg-violet-dot" },
  green: { box: "bg-green-bg text-green-fg", dot: "bg-green-dot" },
  red: { box: "bg-red-bg text-red-fg", dot: "bg-red-dot" },
  accent: { box: "bg-accent-50 text-accent-700", dot: "bg-accent-500" },
};

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  placed: "neutral",
  confirmed: "blue",
  packed: "amber",
  shipped: "violet",
  delivered: "green",
  cancelled: "red",
};

export const SEVERITY_TONE: Record<IssueSeverity, Tone> = { low: "neutral", medium: "amber", high: "red" };

export const SENTIMENT_TONE: Record<Sentiment, Tone> = { positive: "green", neutral: "neutral", negative: "red" };

const kindLabel = { status: "Status", severity: "Severity", sentiment: "Sentiment" } as const;

type BadgeProps =
  | { kind: "status"; value: OrderStatus; className?: string }
  | { kind: "severity"; value: IssueSeverity; className?: string }
  | { kind: "sentiment"; value: Sentiment; className?: string }
  | { kind?: undefined; tone?: Tone; children: ReactNode; dot?: boolean; className?: string };

/**
 * A small coloured label. Use kind="status" | "severity" | "sentiment" with a value for the
 * fixed colour maps, or a tone with your own text. The colour is never the only signal:
 * the label always says it in words.
 */
export function Badge(props: BadgeProps) {
  let tone: Tone;
  let content: ReactNode;
  let dot = true;
  let srPrefix: string | null = null;
  if (props.kind === "status") {
    tone = STATUS_TONE[props.value];
    content = humanize(props.value);
  } else if (props.kind === "severity") {
    tone = SEVERITY_TONE[props.value];
    content = humanize(props.value);
  } else if (props.kind === "sentiment") {
    tone = SENTIMENT_TONE[props.value];
    content = humanize(props.value);
  } else {
    tone = props.tone ?? "neutral";
    content = props.children;
    dot = props.dot ?? false;
  }
  if (props.kind) srPrefix = `${kindLabel[props.kind]}: `;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone].box,
        props.className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", tones[tone].dot)} />}
      {srPrefix && <span className="sr-only">{srPrefix}</span>}
      {content}
    </span>
  );
}
