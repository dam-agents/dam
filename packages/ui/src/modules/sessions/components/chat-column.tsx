import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Padding around the chat content. The chat section is an `@container/chat`:
// it gets narrow when the panels beside it are resized, while the window
// stays wide, so the padding follows its width and not the viewport.
export const CHAT_GUTTER = "px-1 @xs/chat:px-4 @3xl/chat:px-8";

export function ChatColumn({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[813px] px-1 @xs/chat:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
