import { isProtectedAgentEnvName } from "api-server-api";

import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SectionHeading } from "@/components/ui/section-heading";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { useEgressRulesForAgent } from "../../egress-rules/api/queries.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "./connections-section.js";
import { SandboxProvidersSection } from "./sandbox-providers-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Services panel of the unified toolbar: the
 * model providers the Agent may use and its chat default, the connections it
 * holds, and its environment variables, each as the section its configuration
 * page already renders, under text-only headings and in that order.
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
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const envCount = (agent.env ?? []).filter(
    (entry) => !isProtectedAgentEnvName(entry.name),
  ).length;
  const rules = useEgressRulesForAgent(agent.id).data ?? [];
  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionHeading
          label="Providers"
          addLabel="Add provider"
          onAdd={() => navigateToSettings("providers")}
        />
        <SandboxProvidersSection
          agentId={agent.id}
          header={() => null}
          defaultsKinds={[]}
          compact
        />
      </section>
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
      <CollapsibleSection title="Network access" count={rules.length}>
        <p className="mb-3 text-sm text-muted-foreground">
          Unmatched requests wait for your approval on Home.
        </p>
        <AgentEgressEditor agentId={agent.id} header={() => null} compact />
      </CollapsibleSection>
      <CollapsibleSection title="Environment variables" count={envCount}>
        <EnvTab
          agent={agent}
          header={() => null}
          panel
          panelDescription="Exposed to the sandbox. Use Connections for injected secrets."
        />
      </CollapsibleSection>
    </div>
  );
}
