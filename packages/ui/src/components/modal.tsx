import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

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
 * `<main>` stacking context (z-10). Without the portal, MobileNav (z-40)
 * would render above the modal because the modal's effective stacking
 * happens at z-10 from the root's perspective.
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
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 md:px-0 bg-black/50 backdrop-blur-[4px] anim-in">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className={`${widthClass} max-h-[95dvh] md:max-h-[85vh] overflow-hidden rounded-xl border border-border bg-surface flex flex-col anim-scale-in shadow-xl`}
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

/** Top region of a dialog. Holds the title (and optionally a subtitle or
 *  a small form field). Tighter horizontal padding on mobile. Picks up
 *  the `aria-labelledby` id from `ModalContext` so the parent `Modal` can
 *  point to it without callers wiring ids manually. */
export function DialogHeader({ children, className }: DialogRegionProps) {
  const { labelId } = useContext(ModalContext);
  return (
    <div
      id={labelId}
      className={`px-5 md:px-7 pt-5 md:pt-7 pb-4 border-b-2 border-border-light ${className ?? ""}`}
    >
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
export function DialogBody({ children, className }: DialogRegionProps) {
  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto px-5 md:px-7 py-5 ${className ?? ""}`}
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
      className={`px-5 md:px-7 py-4 border-t-2 border-border-light flex items-center justify-end gap-3 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Trap Tab inside `containerRef` and restore focus to the previously
 *  focused element on unmount. If nothing inside is focused yet (e.g. no
 *  `autoFocus` field), focus jumps to the first focusable. Shared by
 *  `Modal` and `DialogOverlay` so global confirms get the same behavior. */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (!container.contains(document.activeElement)) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
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
