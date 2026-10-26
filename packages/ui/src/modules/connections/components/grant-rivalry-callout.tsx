import type { ConnectionView } from "api-server-api";
import { useMemo } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { grantRivalries, grantRivalryWarning } from "../lib/grant-rivals.js";

export function GrantRivalryCallout({
  granted,
  className,
}: {
  granted: readonly ConnectionView[];
  className?: string;
}) {
  const rivalries = useMemo(() => grantRivalries(granted), [granted]);
  if (rivalries.length === 0) return null;
  return (
    <Callout
      tone="warning"
      size="sm"
      inset
      className={cn("flex flex-col gap-1 text-sm text-foreground", className)}
      data-testid="grant-rivalry-callout"
    >
      {rivalries.map((rivalry) => (
        <p key={`${rivalry.connection.id}:${rivalry.rival.id}`}>
          {grantRivalryWarning(rivalry)}
        </p>
      ))}
    </Callout>
  );
}
