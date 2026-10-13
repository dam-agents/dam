import { Information } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The standing reminder that an agent bound to a
 * channel or group chat lets everyone there use its connections with the
 * owner's access. It informs and never blocks; the confirmation that comes
 * with adding or binding is a separate step.
 */
export function SharedChannelsNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Callout
      role="status"
      tone="muted"
      size="sm"
      className={cn("flex items-start gap-2.5 text-sm", className)}
      data-testid="shared-channels-notice"
    >
      <Information
        size={16}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      <p className="min-w-0 flex-1 text-muted-foreground">{children}</p>
    </Callout>
  );
}
