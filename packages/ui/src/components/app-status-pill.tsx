import type { AppConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = AppConnectionView["status"] | undefined;

function styleFor(status: Status): {
  className: string;
  dotClass: string;
  label: string;
} {
  switch (status) {
    case "active":
      return {
        className: "bg-success-light text-success border-success",
        dotClass: "bg-success",
        label: "Connected",
      };
    case "expired":
      return {
        className: "bg-destructive/10 text-destructive border-destructive",
        dotClass: "bg-destructive",
        label: "Expired",
      };
    case "disconnected":
      return {
        className: "bg-muted text-muted-foreground border-border",
        dotClass: "bg-muted-foreground",
        label: "Disconnected",
      };
    case "pending":
      return {
        className: "bg-muted text-muted-foreground border-border",
        dotClass: "bg-muted-foreground",
        label: "Pending",
      };
    default:
      return {
        className: "bg-muted text-muted-foreground border-border",
        dotClass: "bg-muted-foreground",
        label: "Unresolved",
      };
  }
}

export function AppStatusPill({
  status,
  size = "sm",
}: {
  status: Status;
  size?: "sm" | "md";
}) {
  const { className, dotClass, label } = styleFor(status);
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-semibold uppercase tracking-wide shrink-0",
        size === "md" ? "text-[11px] px-2.5" : "text-[10px] px-2",
        className,
      )}
    >
      <span
        className={cn("inline-block w-2 h-2 rounded-full shrink-0", dotClass)}
      />
      {label}
    </Badge>
  );
}
