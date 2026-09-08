import { Close } from "@carbon/icons-react";
import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ModalProps {
  widthClass?: string;
  onClose?: () => void;
  children: ReactNode;
}

export function Modal({
  widthClass = "w-[560px]",
  onClose,
  children,
}: ModalProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useEscapeWhenTopmost(labelId, onClose);
  return createPortal(
    <ModalContext.Provider value={{ labelId }}>
      <div className="fixed inset-0 z-overlay flex items-center justify-center px-4 md:px-0 bg-black/50 backdrop-blur-[4px] anim-in">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className={`${widthClass} max-h-[95dvh] md:max-h-[85vh] overflow-hidden rounded-xl border border-border bg-card flex flex-col anim-scale-in shadow-xl`}
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}

const ModalContext = createContext<{ labelId: string | undefined }>({
  labelId: undefined,
});

interface DialogRegionProps {
  children: ReactNode;
  className?: string;
}

interface DialogHeaderProps {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  titleAccessory?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  closeTestId?: string;
  truncateTitle?: boolean;
  divided?: boolean;
}

export function DialogHeader({
  title,
  titleAccessory,
  actions,
  subtitle,
  onClose,
  closeDisabled,
  closeTestId,
  truncateTitle,
  divided = true,
  children,
  className,
}: DialogHeaderProps) {
  const { labelId } = useContext(ModalContext);
  return (
    <div
      id={title ? undefined : labelId}
      data-dialog-noautofocus
      className={cn(
        "px-5 py-5 md:px-6 md:py-6",
        divided && "border-b border-border",
        className,
      )}
    >
      {(title || subtitle || onClose || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className="flex min-h-7 items-center gap-2">
                <h2
                  id={labelId}
                  className={cn(
                    "text-base font-semibold text-foreground",
                    truncateTitle && "truncate",
                  )}
                >
                  {title}
                </h2>
                {titleAccessory}
              </div>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {(actions || onClose) && (
            <div className="flex shrink-0 items-center gap-3">
              {actions}
              {onClose && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  disabled={closeDisabled}
                  aria-label="Close"
                  data-dialog-close
                  data-testid={closeTestId}
                  className="shrink-0 text-muted-foreground"
                >
                  <Close size={16} />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export function DialogBody({
  children,
  className,
  flush,
  divided,
}: DialogRegionProps & { flush?: boolean; divided?: boolean }) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto pt-5 md:pt-6 [&:last-child]:pb-5 md:[&:last-child]:pb-6",
        !flush && "px-5 md:px-6",
        divided &&
          "pb-5 md:pb-6 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DialogFooter({ children, className }: DialogRegionProps) {
  return (
    <div
      className={cn(
        "px-5 py-5 md:px-6 md:py-6 flex items-center justify-end gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface DialogActionsProps {
  leading?: ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
  label: string;
  pendingLabel: string;
  pending?: boolean;
  cancelDisabled?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSubmit?: () => void;
  testId?: string;
  className?: string;
}

export function DialogActions({
  leading,
  onCancel,
  cancelLabel = "Cancel",
  label,
  pendingLabel,
  pending = false,
  cancelDisabled = false,
  disabled = false,
  destructive = false,
  onSubmit,
  testId,
  className,
}: DialogActionsProps) {
  return (
    <DialogFooter className={className}>
      {leading && <div className="mr-auto">{leading}</div>}
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={cancelDisabled}
      >
        {cancelLabel}
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        variant={destructive ? "destructive" : "default"}
        onClick={onSubmit}
        disabled={disabled || pending}
        data-testid={testId}
      >
        {pending ? pendingLabel : label}
      </Button>
    </DialogFooter>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.getClientRects().length > 0);
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    let grabRaf = 0;
    const reassertUntil = performance.now() + 500;
    const grab = () => {
      if (!container.contains(document.activeElement)) {
        const focusables = focusablesIn(container);
        const target =
          focusables.find(
            (el) =>
              !el.hasAttribute("data-dialog-close") &&
              el.closest("[data-dialog-noautofocus]") === null,
          ) ?? focusables[0];
        target?.focus();
      }
      if (performance.now() < reassertUntil)
        grabRaf = requestAnimationFrame(grab);
    };
    grab();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = focusablesIn(container);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(grabRaf);
      container.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [containerRef]);
}

const openModalIds: string[] = [];

function useEscapeWhenTopmost(id: string, onClose: (() => void) | undefined) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openModalIds.push(id);
    return () => {
      const at = openModalIds.indexOf(id);
      if (at !== -1) openModalIds.splice(at, 1);
    };
  }, [id]);

  useEffect(() => {
    const closeIfTopmost = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openModalIds[openModalIds.length - 1] !== id) return;
      close.current?.();
    };
    window.addEventListener("keydown", closeIfTopmost);
    return () => window.removeEventListener("keydown", closeIfTopmost);
  }, [id]);
}

let bodyLockCount = 0;
let previousBodyOverflow = "";

export function useBodyScrollLock() {
  useEffect(() => {
    if (bodyLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockCount++;
    return () => {
      bodyLockCount--;
      if (bodyLockCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, []);
}
