import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
