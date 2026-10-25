import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Card } from "@/components/ui/card";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import { CardIcon } from "./card-icon.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one of the owner's providers on an agent's Models
 * page, read-only (D105): picking a profile is what grants a provider, so the
 * row reads what it runs and carries Detach alone, with anything about the
 * attached provider, such as its spend limit, beneath.
 */
export function ProviderGrantRow({
  provider,
  harnesses,
  note,
  actionsLabel,
  actions,
  children,
}: {
  provider: ProviderConnectionRef;
  harnesses: readonly string[] | undefined;
  note?: ReactNode;
  actionsLabel?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <CardIcon provider={provider.type} templateId={provider.templateId} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-foreground">
            {provider.name}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Supports:
            {harnesses?.length ? (
              <HarnessIcons
                harnesses={harnesses}
                size="sm"
                className="flex-wrap opacity-70"
              />
            ) : (
              <span>{harnesses ? "None" : "Compatibility unavailable"}</span>
            )}
          </span>
          {note && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {note}
            </span>
          )}
        </div>
        {actions && actionsLabel && (
          <RowActionsMenu
            label={actionsLabel}
            testId="provider-menu"
            className="-mr-1 -mt-1 shrink-0"
          >
            {actions}
          </RowActionsMenu>
        )}
      </div>
      {children}
    </Card>
  );
}
