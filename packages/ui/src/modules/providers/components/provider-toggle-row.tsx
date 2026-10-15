import { HarnessIcons } from "@/components/harness-icons";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import { CardIcon } from "./card-icon.js";

// UNIT_BOUNDARY_DESCRIPTION: one provider the owner holds, with the harnesses it runs, and a switch for whether this agent uses it. The agent's Providers page and the attach dialog show the same row.
export function ProviderToggleRow({
  provider,
  harnesses,
  checked,
  disabled,
  onCheckedChange,
}: {
  provider: ProviderConnectionRef;
  harnesses: readonly string[] | undefined;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <CardIcon provider={provider.type} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-foreground">
          {provider.name}
        </span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          supports:
          {harnesses?.length ? (
            <HarnessIcons
              harnesses={harnesses}
              size="sm"
              className="opacity-70"
            />
          ) : (
            <span>{harnesses ? "None" : "Compatibility unavailable"}</span>
          )}
        </span>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        label={`Use ${provider.name} in this agent`}
        onCheckedChange={onCheckedChange}
      />
    </Card>
  );
}
