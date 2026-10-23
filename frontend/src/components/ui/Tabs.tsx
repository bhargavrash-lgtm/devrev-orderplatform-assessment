import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface TabItem {
  id: string;
  label: string;
  /** Small count shown next to the label. */
  count?: number;
  content: ReactNode;
}

interface TabsProps {
  label: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
}

/** WAI-ARIA tabs: arrow keys move between tabs, Home/End jump to the ends, Tab moves into the panel. */
export function Tabs({ label, items, value, onChange }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" ? (activeIndex === last ? 0 : activeIndex + 1)
      : event.key === "ArrowLeft" ? (activeIndex === 0 ? last : activeIndex - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next]!.id);
    tabRefs.current[next]?.focus();
  };

  const active = items[activeIndex];
  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={item.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                "focus-ring -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                selected ? "border-accent-600 text-accent-700" : "border-transparent text-ink-subtle hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-2xs", selected ? "bg-accent-50 text-accent-700" : "bg-line-soft text-ink-subtle")}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className="focus-ring rounded pt-5"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
