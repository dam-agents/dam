import { ToggleRow } from "@/components/ui/toggle-row";

import { useSetChildEgress } from "../api/mutations.js";
import { useChildEgress } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: the owner's switch that lets the agent give its sub-agents and Environments network access of their own, wider than its own rules. Off, such a rule waits for the owner's approval on Home, and approving it writes that one rule. Turning the switch on also writes every rule that waits for it. Hidden where it is not offered: without the Environments feature, and on an agent that is itself a sub-agent or an Environment.
export function ChildEgressToggle({
  agentId,
  disabled = false,
}: {
  agentId: string;
  disabled?: boolean;
}) {
  const { data } = useChildEgress(agentId);
  const set = useSetChildEgress();
  if (!data || data.state === "unavailable") return null;
  const on = set.isPending ? set.variables.on : data.state === "on";
  return (
    <ToggleRow
      className="mt-5 mb-6"
      title="Sub-agents and Environments may have network access of their own"
      description="Lets the agent give a sub-agent or Environment it creates network rules that reach hosts the agent itself cannot. Off, each such rule waits for your approval on Home. A rule for a wildcard host, such as * or *.example.com, always waits for you."
      checked={on}
      disabled={disabled || set.isPending}
      onCheckedChange={(next) => set.mutate({ agentId, on: next })}
    />
  );
}
