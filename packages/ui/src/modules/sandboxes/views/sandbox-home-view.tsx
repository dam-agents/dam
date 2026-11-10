import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  findAgent,
  useAgents,
  useIsAgentInaccessible,
} from "../../agents/api/queries.js";
import { useHarnessConfigWatch } from "../../agents/hooks/use-harness-config-watch.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { AgentConfiguration } from "../components/agent-configuration.js";

export function SandboxHomeView() {
  const agentId = useStore((s) => s.agentId);
  const agentsQuery = useAgents();
  const agent = agentId ? findAgent(agentsQuery.data, agentId) : null;
  const agentInaccessible = useIsAgentInaccessible(agentId);
  usePublicAgentFallback(agentId, agentInaccessible);

  if (!agent) {
    return (
      <div>
        {!agentId && (
          <p className="text-sm text-muted-foreground">No agent selected.</p>
        )}
        {agentId && agentsQuery.data !== undefined && (
          <p className="text-sm text-muted-foreground">Agent not found.</p>
        )}
      </div>
    );
  }
  return <AgentHome key={agent.id} agent={agent} />;
}

function AgentHome({ agent }: { agent: AgentView }) {
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const openAgentSession = useStore((s) => s.openAgentSession);

  const display = useResolvedAgentDisplay(agent);
  useHarnessConfigWatch(agent.id);

  if (!display) return null;

  return (
    <AgentConfiguration
      agent={agent}
      display={display}
      section={section}
      onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
      onOpenSession={(sessionId) => openAgentSession(agent.id, sessionId)}
      oauthReturnView={routeToPath({
        view: "sandbox-home",
        agentId: agent.id,
        sandboxSection: "connections",
      })}
    />
  );
}
