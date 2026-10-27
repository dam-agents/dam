import { Switch } from "@/components/ui/switch";

import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import { ProviderSpendBadge } from "../../spend/components/provider-spend-badge.js";
import { ProviderHead } from "./provider-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider for an agent, wherever an agent's
 * providers are listed (its Providers page and panel, the attach dialog): a
 * single line of a small icon, its name, the spend badge that opens its limit
 * and the switch that decides whether this agent uses it.
 */
export function ProviderSpendRow({
  agentId,
  provider,
  harnesses,
  checked,
  disabled,
  showSpend,
  onCheckedChange,
}: {
  agentId: string | null;
  provider: ProviderConnectionRef;
  harnesses: readonly string[] | undefined;
  checked: boolean;
  disabled?: boolean;
  showSpend: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <ProviderHead
        type={provider.type}
        templateId={provider.templateId}
        name={provider.name}
        harnesses={harnesses}
      />
      {showSpend && agentId && provider.templateId && (
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
