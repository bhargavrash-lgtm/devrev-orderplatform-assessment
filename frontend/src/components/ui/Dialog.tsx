import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { useFocusTrap } from "./useFocusTrap";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

function Overlay({ onClose }: { onClose: () => void }) {
  return <div aria-hidden="true" className="fixed inset-0 animate-fade-in bg-black/30" onClick={onClose} />;
}

function DialogHeader({ title, description, titleId, descriptionId, onClose }:
  { title: string; description?: ReactNode; titleId: string; descriptionId: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
        {description && <p id={descriptionId} className="mt-0.5 text-sm text-ink-subtle">{description}</p>}
      </div>
      <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
        <X className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/** Centered dialog. Focus is trapped inside, Escape and the backdrop close it, focus returns afterwards. */
export function Modal({ open, onClose, title, description, children, footer }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <Overlay onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative w-full max-w-lg animate-slide-up rounded-card border border-line bg-white shadow-overlay outline-none"
      >
        <DialogHeader {...{ title, description, titleId, descriptionId, onClose }} />
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-soft px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Panel that slides in from the right; same keyboard and focus behaviour as Modal. */
export function Drawer({ open, onClose, title, description, children, footer, width = "md" }:
  DialogProps & { width?: "sm" | "md" }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <Overlay onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col bg-white shadow-overlay outline-none",
          width === "sm" ? "max-w-sm" : "max-w-md",
        )}
      >
        <DialogHeader {...{ title, description, titleId, descriptionId, onClose }} />
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-line-soft px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
