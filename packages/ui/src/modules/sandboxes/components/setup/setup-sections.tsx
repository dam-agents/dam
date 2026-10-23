import { SectionLabel } from "@/components/ui/section-label";
import { ToggleRow } from "@/components/ui/toggle-row";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useUpdateAgent } from "../../../agents/api/mutations.js";
import { GATEWAY_RESTART_TITLE } from "../../../egress-rules/gateway-restart.js";

export function ConnectionAddressingSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const update = useUpdateAgent();
  const value =
    (update.isPending
      ? update.variables.requireConnectionAddress
      : undefined) ?? agent.requireConnectionAddress;

  const onChange = async (next: boolean) => {
    if (
      await showConfirm(
        "Network access restarts (~5–15s) to change how credentials are injected. The agent keeps running — its requests in flight fail.",
        GATEWAY_RESTART_TITLE,
        { confirmLabel: "Change and restart" },
      )
    )
      update.mutate({ id: agent.id, requireConnectionAddress: next });
  };

  return (
    <section className="mb-8">
      <SectionLabel spaced>Credential injection</SectionLabel>
      <ToggleRow
        title="Inject only into addressed requests"
        description="Credentials go only into requests that name a connection; others are sent as-is. The browser panel needs it. Turn it off for an agent whose tools need credentials added to requests that name no connection."
        checked={value}
        onCheckedChange={(next) => void onChange(next)}
      />
    </section>
  );
}
