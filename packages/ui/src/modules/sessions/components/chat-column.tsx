import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ChatColumn({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[813px] px-4", className)}>
      {children}
    </div>
  );
}
