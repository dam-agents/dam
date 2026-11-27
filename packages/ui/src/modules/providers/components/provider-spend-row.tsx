import { type ReactNode, useState } from "react";

import { Switch } from "@/components/ui/switch";

import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import {
  AgentProviderLimitPanel,
  useConnectionSpendLimit,
} from "../../spend/components/connection-spend-limit.js";
import {
  LimitChevron,
  SpendToggle,
} from "../../spend/components/provider-limit-panel.js";
import { ProviderHead } from "./provider-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider for an agent, wherever an agent's
 * providers are listed (its Providers page and panel, the attach dialog): a
 * row of its mark, its name over its description, its spend today and a
 * chevron that open its limits below the row, and the switch that decides
 * whether this agent uses it.
 */
interface RowProps {
  provider: ProviderConnectionRef;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
}

export function ProviderSpendRow({
  agentId,
  showSpend,
  ...row
}: RowProps & { agentId: string | null; showSpend: boolean }) {
  return showSpend && agentId && row.provider.templateId ? (
    <RowWithLimit {...row} agentId={agentId} />
  ) : (
    <Row {...row} />
  );
}

function Row({
  provider,
  checked,
  disabled,
  onCheckedChange,
  spend,
  chevron,
}: RowProps & { spend?: ReactNode; chevron?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <ProviderHead
        type={provider.type}
        templateId={provider.templateId}
        name={provider.name}
      />
      {spend}
      <Switch
        checked={checked}
        disabled={disabled}
        label={`Use ${provider.name} in this agent`}
        onCheckedChange={onCheckedChange}
      />
      {chevron}
    </div>
  );
}

function RowWithLimit({ agentId, ...row }: RowProps & { agentId: string }) {
  const { provider } = row;
  const [open, setOpen] = useState(false);
  const spend = useConnectionSpendLimit({
    agentId,
    connectionId: provider.id,
    connectionName: provider.name,
    templateId: provider.templateId ?? "",
  });
  if (!spend) return <Row {...row} />;
  const toggle = {
    open,
    onToggle: () => setOpen((was) => !was),
    controls: `agent-provider-limit-${provider.id}`,
    subject: provider.name,
  };
  return (
    <>
      <Row
        {...row}
        spend={
          !open && (
            <SpendToggle
              spentMicros={spend.spentMicros}
              unit={spend.rule.unit}
              toggle={toggle}
            />
          )
        }
        chevron={<LimitChevron toggle={toggle} />}
      />
      {open && (
        <AgentProviderLimitPanel
          id={toggle.controls}
          spend={spend}
          agentId={agentId}
          connectionId={provider.id}
        />
      )}
    </>
  );
}
