import type { CarbonIconType } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A one-line state notice above a section: an
 * icon, a bold lead, a muted explanation and an optional action, such as
 * "This agent is stopped — Start agent". Warning notices use the warning tone.
 */
export function Notice({
  icon: Icon,
  title,
  children,
  action,
  tone = "muted",
  className,
}: {
  icon: CarbonIconType;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "muted" | "warning";
  className?: string;
}) {
  return (
    <Callout
      role="status"
      tone={tone}
      className={cn("flex items-start gap-2.5 px-4 py-3 text-sm", className)}
    >
      <Icon
        size={16}
        className={cn(
          "mt-px shrink-0",
          tone === "warning" ? "text-warning-fg" : "text-muted-foreground",
        )}
      />
      <p className="min-w-0 flex-1">
        <span
          className={cn(
            "font-semibold",
            tone === "warning" && "text-warning-fg",
          )}
        >
          {title}
        </span>{" "}
        {children && <span className="text-muted-foreground">{children}</span>}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </Callout>
  );
}
