import type { AgentView } from "../../../types.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "./connections-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Services panel of the unified toolbar: the
 * connections the Agent holds, its network rules and its environment variables,
 * each as the section its configuration page already renders, in that order,
 * always open, with the one add button that belongs to it on its heading and no
 * copy under it. The providers and the spending are the Models panel's.
 */
export function ServicesPanel({
  agent,
  sessionId,
  onGoToChannels,
}: {
  agent: AgentView;
  sessionId: string | null;
  onGoToChannels: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <ConnectionsSection
          panelHeading="Connections"
          agentId={agent.id}
          header={() => null}
          oauthReturnView={routeToPath({
            view: "chat",
            agent: agent.id,
            ...(sessionId ? { session: sessionId } : {}),
          })}
          onGoToChannels={onGoToChannels}
        />
      </section>
      <section>
        <AgentEgressEditor agentId={agent.id} header={() => null} compact />
      </section>
      <section>
        <EnvTab
          agent={agent}
          header={() => null}
          panelHeading="Environment variables"
        />
      </section>
    </div>
  );
}
