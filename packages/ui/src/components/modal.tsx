import { Close } from "@carbon/icons-react";
import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ModalProps {
  widthClass?: string;
  children: ReactNode;
}

/**
 * Centered overlay modal. Closes only via explicit
 * actions in the modal body — backdrop clicks and Escape are ignored so
 * users can't lose in-progress form state by accident.
 *
 * Renders into document.body via a portal so it escapes the app shell's
 * `<main>` stacking context (z-content). Without the portal, the mobile
 * bottom bar (z-nav) would render above the modal because the modal's
 * effective stacking happens at z-content from the root's perspective.
 *
 * Compose the inside with `DialogHeader`, `DialogBody`, and `DialogFooter`
 * so layout (padding, dividers, scroll region) is consistent across every
 * dialog and cross-cutting fixes happen in one place. Extras like a tab
 * strip can sit between Header and Body as plain children.
 *
 * A11y: announces as `role="dialog"` with `aria-modal="true"` and is
 * labelled by `DialogHeader` (which picks up the id from `ModalContext`).
 * Tab cycles inside the panel; the previously focused element is restored
 * on unmount; body scroll is locked while mounted.
 */
export function Modal({ widthClass = "w-[560px]", children }: ModalProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
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
  /** Sits beside the title, outside the `<h2>` so it stays out of the dialog's
   *  accessible name. */
  titleAccessory?: ReactNode;
  subtitle?: ReactNode;
  /** Draws the ✕. Omit only where the dialog exists to force a choice. */
  onClose?: () => void;
  /** Gate the ✕ while an in-flight action would lose something if the dialog
   *  went away — a one-time secret, or a multi-step write mid-way. */
  closeDisabled?: boolean;
  closeTestId?: string;
  truncateTitle?: boolean;
  divided?: boolean;
}

/** Top region of a dialog. Picks up the `aria-labelledby` id from
 *  `ModalContext` so callers don't wire ids manually — it lands on the `<h2>`
 *  when there is a `title`, otherwise on the region itself. */
export function DialogHeader({
  title,
  titleAccessory,
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
      className={cn(
        "px-5 pt-5 pb-4 md:px-7 md:pt-7",
        divided && "border-b border-border",
        className,
      )}
    >
      {(title || subtitle || onClose) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2">
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
              /* Pulled out of the header's padding so it sits 16px off the
                 panel corner at both breakpoints, rather than lining up with
                 the title. */
              className="-mt-1 -mr-1 shrink-0 text-muted-foreground md:-mt-3 md:-mr-3"
            >
              <Close size={16} />
            </Button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** Scrollable content region. Callers add their own `flex flex-col gap-N`
 *  via className — content density varies by dialog and Tailwind utility
 *  overrides aren't reliable without tailwind-merge. `min-h-0` is the
 *  load-bearing detail: without it a flex child won't shrink below its
 *  content, so the modal's max-height cap can't push the footer down —
 *  the body would push it off-screen. */
export function DialogBody({
  children,
  className,
  flush,
}: DialogRegionProps & { flush?: boolean }) {
  // `flush` drops the horizontal padding so full-bleed content (e.g. a list
  // whose row dividers must span the modal width) can own its own gutter.
  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto py-5 ${flush ? "" : "px-5 md:px-7"} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Sticky bottom region with action buttons. `items-center` lets callers
 *  drop an `mr-auto` element (e.g. an inline warning) without re-aligning. */
export function DialogFooter({ children, className }: DialogRegionProps) {
  return (
    <div
      className={`px-5 md:px-7 py-4 flex items-center justify-end gap-3 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

interface DialogActionsProps {
  onCancel: () => void;
  cancelLabel?: string;
  label: string;
  /** Replaces `label` while `pending`. Required so a pending button can never
   *  sit there looking idle. */
  pendingLabel: string;
  pending?: boolean;
  /** Gate Cancel while an in-flight action would lose something if the dialog
   *  went away. Off by default: a dialog should stay escapable. */
  cancelDisabled?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** Omit inside a `<form>` so the button submits it; pass to drive the action
   *  from a handler instead. */
  onSubmit?: () => void;
  testId?: string;
  className?: string;
}

/** The dismiss + confirm pair a dialog ends with. Cancel is always an outline
 *  button and always `type="button"`, so it can't submit the form it sits in,
 *  and it stays enabled while the confirm is pending so the dialog is always
 *  escapable. */
export function DialogActions({
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

/** Focusables that can actually take focus. The selector alone also matches
 *  unrendered elements — several dialogs open with a `display: none` file
 *  input first in the DOM — and `focus()` on one is a no-op, which would leave
 *  focus outside the panel and make Tab dead-end on it. Tested by client
 *  rects rather than `offsetParent`, which is also null for `position: fixed`
 *  elements that are perfectly focusable. */
function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.getClientRects().length > 0);
}

/** Trap Tab inside `containerRef` and restore focus to the previously
 *  focused element on unmount. If nothing inside is focused yet (e.g. no
 *  `autoFocus` field), focus jumps to the first focusable. Shared by
 *  `Modal` and `DialogOverlay` so global confirms get the same behavior.
 *
 *  `DialogHeader` marks its ✕ with `data-dialog-close` so the initial grab can
 *  skip it — keep that attribute on any other close affordance added here, or
 *  opening the dialog will focus it and the first Enter will dismiss. */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // A spawning menu's focus trap stays alive through its exit animation and
    // refocuses its trigger at the end, so re-assert until it gives up.
    let grabRaf = 0;
    const reassertUntil = performance.now() + 500;
    const grab = () => {
      if (!container.contains(document.activeElement)) {
        const focusables = focusablesIn(container);
        // Skip the header's ✕ when there is anything else to land on: it comes
        // first in the DOM, so focusing it would make the opening keystroke
        // dismiss the dialog.
        const target =
          focusables.find((el) => !el.hasAttribute("data-dialog-close")) ??
          focusables[0];
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

// Ref-counted so nested overlays (e.g. a DialogOverlay confirm on top of a
// Modal) share one lock and the original overflow is restored only when
// the outermost overlay unmounts.
let bodyLockCount = 0;
let previousBodyOverflow = "";

/** Lock `body` scroll while the calling component is mounted. Prevents
 *  background content from scrolling behind a portaled overlay, which is
 *  especially noticeable on mobile where touch scroll otherwise leaks
 *  through the backdrop. */
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
