import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function IconButton({
  onClick,
  label,
  hoverTone,
  className,
  children,
}: {
  onClick: () => void | Promise<void>;
  label: string;
  hoverTone: "accent" | "danger" | "neutral";
  className?: string;
  children: ReactNode;
}) {
  const tone =
    hoverTone === "danger"
      ? "hover:text-destructive"
      : hoverTone === "accent"
        ? "hover:text-primary"
        : "";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      className={cn("h-7 w-7", tone, className)}
    >
      {children}
    </Button>
  );
}
