import { type ReactNode } from "react";

interface ModalProps {
  widthClass?: string;
  children: ReactNode;
}

/**
 * Centered overlay modal with brutal styling. Closes only via explicit
 * actions in the modal body — backdrop clicks and Escape are ignored so
 * users can't lose in-progress form state by accident.
 */
export function Modal({
  widthClass = "w-[560px]",
  children,
}: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in">
      <div
        className={`${widthClass} max-h-[85vh] overflow-hidden rounded-xl border-2 border-border bg-surface flex flex-col anim-scale-in`}
        style={{ boxShadow: "var(--shadow-brutal)" }}
      >
        {children}
      </div>
    </div>
  );
}
