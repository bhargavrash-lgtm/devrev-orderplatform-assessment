import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
}

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: ReactNode;
  /** Non-interactive content at the top of the menu, e.g. who is signed in. */
  header?: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}

/** Menu button: Enter/Space/ArrowDown open it, arrows move, Escape closes and returns focus. */
export function Menu({ label, trigger, header, items, align = "right" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") setOpen(false);
    else if (event.key === "ArrowDown") { event.preventDefault(); itemRefs.current[current >= last ? 0 : current + 1]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); itemRefs.current[current <= 0 ? last : current - 1]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); itemRefs.current[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); itemRefs.current[last]?.focus(); }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
        }}
        className="focus-ring flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-line-soft"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-40 mt-2 w-64 animate-fade-in overflow-hidden rounded-card border border-line bg-white py-1 shadow-raised",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {header && <div className="border-b border-line-soft px-4 py-3">{header}</div>}
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => { itemRefs.current[index] = el; }}
              role="menuitem"
              type="button"
              tabIndex={-1}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cn(
                "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm outline-none transition-colors focus-visible:bg-line-soft hover:bg-line-soft",
                item.tone === "danger" ? "text-red-fg" : "text-ink",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
