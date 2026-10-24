import type { AgentView } from "../../../types.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import { AgentSleepSection } from "./agent-config-sections.js";
import { AgentManagementActions } from "./agent-management-actions.js";
import { AgentUpdateRow } from "./agent-update-row.js";
import { SandboxIdentity } from "./sandbox-home-header.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agent panel of the unified toolbar: who the
 * Agent is, the sandbox it can move to, how it sleeps and how large it runs,
 * the ways to manage it, and what it spends — the configuration page's own
 * sections, with its navigation gone.
 */
export function AgentPanel({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SandboxIdentity agent={agent} display={display} />
      <AgentUpdateRow agent={agent} />
      <AgentSleepSection agent={agent} />
      <AgentManagementActions agent={agent} display={display} />
      <SandboxUsageSection agentId={agent.id} />
    </div>
  );
}
