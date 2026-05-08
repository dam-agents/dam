import type { ReactNode } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ModalProps {
  widthClass?: string;
  children: ReactNode;
}

/**
 * Centered modal. Thin wrapper around the shadcn Dialog that matches the
 * prior `<Modal>` API — always open, closed only by explicit actions in the
 * body (the surrounding component controls mount/unmount).
 */
export function Modal({
  widthClass = "w-[560px]",
  children,
}: ModalProps) {
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className={cn("max-h-[85vh] overflow-hidden flex flex-col p-0", widthClass)}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
