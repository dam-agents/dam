import { SectionLabel } from "@/components/ui/section-label";

import type { AgentView } from "../../../types.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { AgentModelSettingsSection } from "./agent-config-sections.js";
import { ConnectionsSection } from "./connections-section.js";
import { SandboxProvidersSection } from "./sandbox-providers-section.js";
import { SECTIONS } from "./sandbox-section-nav.js";
import { ConnectionAddressingSection } from "./setup/setup-sections.js";

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
  const envDescription = SECTIONS.find(
    (entry) => entry.section === "environment",
  )?.description;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionLabel spaced>Providers</SectionLabel>
        <SandboxProvidersSection
          agentId={agent.id}
          header={() => null}
          defaultsKinds={["chat"]}
        />
        <AgentModelSettingsSection agentId={agent.id} />
      </section>
      <section>
        <SectionLabel spaced>Connections</SectionLabel>
        <ConnectionsSection
          agentId={agent.id}
          header={() => null}
          leading={<ConnectionAddressingSection agent={agent} />}
          oauthReturnView={routeToPath({
            view: "chat",
            agent: agent.id,
            ...(sessionId ? { session: sessionId } : {}),
          })}
          onGoToChannels={onGoToChannels}
        />
      </section>
      <section>
        <SectionLabel spaced>Environment variables</SectionLabel>
        {envDescription && (
          <p className="-mt-1 mb-3 text-sm text-muted-foreground">
            {envDescription}
          </p>
        )}
        <EnvTab agent={agent} header={() => null} />
      </section>
    </div>
  );
}
