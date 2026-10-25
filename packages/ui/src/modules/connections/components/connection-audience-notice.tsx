import { Information } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The standing reminder that people other than
 * the owner can use an agent's connections with the owner's access: its
 * Agent Editors, and everyone in a channel or group chat it is bound to. It
 * informs and never blocks; the confirmation that comes with adding or
 * binding is a separate step.
 */
export function ConnectionAudienceNotice({
  children,
  className,
  testId = "connection-audience-notice",
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Callout
      role="status"
      tone="muted"
      size="sm"
      className={cn("flex items-start gap-2.5 text-sm", className)}
      data-testid={testId}
    >
      <Information
        size={16}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      <p className="min-w-0 flex-1 text-muted-foreground">{children}</p>
    </Callout>
  );
}
