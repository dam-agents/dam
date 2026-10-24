import { SectionHeading } from "@/components/ui/section-heading";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
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
      <section>
        <EnvTab
          agent={agent}
          header={() => null}
          panelHeading="Environment variables"
          panelDescription="Exposed to the sandbox. Use Connections for injected secrets."
        />
      </section>
    </div>
  );
}
