import { Switch } from "@/components/ui/switch";

import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import { ProviderSpendBadge } from "../../spend/components/provider-spend-badge.js";
import { CardIcon } from "./card-icon.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider in the Services panel: a single line
 * of a smaller icon, its name, the spend badge that opens its limit and the
 * switch that decides whether this agent uses it. The Agent's Providers page
 * keeps the taller row, which has room for the harnesses it supports.
 */
export function ProviderSpendRow({
  agentId,
  provider,
  checked,
  disabled,
  onCheckedChange,
}: {
  agentId: string;
  provider: ProviderConnectionRef;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <CardIcon
        provider={provider.type}
        templateId={provider.templateId}
        size="tile-sm"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {provider.name}
      </span>
      {provider.templateId && (
        <ProviderSpendBadge
          agentId={agentId}
          connectionId={provider.id}
          connectionName={provider.name}
          templateId={provider.templateId}
        />
      )}
      <Switch
        checked={checked}
        disabled={disabled}
        label={`Use ${provider.name} in this agent`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
