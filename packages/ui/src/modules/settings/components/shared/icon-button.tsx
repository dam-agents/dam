import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Small (28×28) ghost-style icon button used in provider connected/edit
 * chrome. Wraps shadcn's `<Button variant="ghost" size="icon">` with a
 * single hover-tint knob — matches the design-branch shadcn aesthetic
 * (no thick borders or brutal shadows).
 */
export function IconButton({
  onClick,
  title,
  hoverTone,
  children,
}: {
  onClick: () => void | Promise<void>;
  title: string;
  hoverTone: "accent" | "danger" | "neutral";
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
      title={title}
      className={cn("h-7 w-7", tone)}
    >
      {children}
    </Button>
  );
}
