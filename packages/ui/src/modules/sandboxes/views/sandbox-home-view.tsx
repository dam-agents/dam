import type { ReactNode } from "react";

import { useStore } from "../../../store.js";
import { useIsAgentInaccessible } from "../../agents/api/queries.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { SandboxArtifactsSection } from "../../artifacts/components/sandbox-artifacts-section.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { AgentModelSettingsSection } from "../components/agent-config-sections.js";
import { AgentManagementActions } from "../components/agent-management-actions.js";
import { AgentUsageActions } from "../components/agent-usage-actions.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { PeopleSection } from "../components/people-section.js";
import { SandboxChannelsSection } from "../components/sandbox-channels-section.js";
import { SandboxChatFormsSection } from "../components/sandbox-chat-forms-section.js";
import { SandboxEnvSection } from "../components/sandbox-env-section.js";
import { SandboxEnvironmentsSection } from "../components/sandbox-environments-section.js";
import { SandboxHomeHeader } from "../components/sandbox-home-header.js";
import { SandboxNetworkSection } from "../components/sandbox-network-section.js";
import { SandboxProvidersSection } from "../components/sandbox-providers-section.js";
import { SandboxSchedulesSection } from "../components/sandbox-schedules-section.js";
import {
  SandboxSectionNav,
  SECTIONS,
} from "../components/sandbox-section-nav.js";
import { SandboxSkillsSection } from "../components/sandbox-skills-section.js";
import { SandboxTwoColumnShell } from "../components/sandbox-two-column-shell.js";
import { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";

type SectionHeaderSlot = (actions?: ReactNode) => ReactNode;

function makeSectionHeader(
  title: string,
  description?: string,
): SectionHeaderSlot {
  return (actions) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

const SECTIONS_WITH_ACTIONS: ReadonlySet<SandboxSection> = new Set([
  "providers",
  "connections",
  "network",
  "environment",
  "schedules",
  "environments",
]);

export function SandboxHomeView() {
  const f = useSandboxSettingsForm();
  const agentId = useStore((s) => s.agentId);
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const agentInaccessible = useIsAgentInaccessible(agentId);
  usePublicAgentFallback(agentId, agentInaccessible);

  const display = useResolvedAgentDisplay(f.agent);

  const { summaries, warnings } = useSectionSummaries(f.agent);

  if (f.status !== "ready" || !f.agent || !display) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-10 md:px-8">
        {f.status === "no-agent" && (
          <p className="text-sm text-muted-foreground">No agent selected.</p>
        )}
        {f.status === "not-found" && (
          <p className="text-sm text-muted-foreground">Agent not found.</p>
        )}
      </div>
    );
  }

  const { agent } = f;
  const sectionEntry = SECTIONS.find((e) => e.section === section);
  const header = makeSectionHeader(
    sectionEntry?.title ?? "",
    sectionEntry?.description,
  );

  return (
    <SandboxTwoColumnShell
      nav={
        <SandboxSectionNav
          sections={SECTIONS}
          active={section}
          onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
          summaries={summaries}
          warnings={warnings}
        />
      }
    >
      <SandboxHomeHeader agent={agent} display={display} />
      {!SECTIONS_WITH_ACTIONS.has(section) && header()}
      {section === "setup" ? (
        <>
          <AgentUsageActions agent={agent} />
          <AgentModelSettingsSection agentId={agent.id} />
          <SandboxProvidersSection agentId={agent.id} header={header} />
          <AgentManagementActions agent={agent} display={display} />
        </>
      ) : section === "people" ? (
        <PeopleSection agent={agent} />
      ) : section === "providers" ? (
        <SandboxProvidersSection agentId={agent.id} header={header} />
      ) : section === "network" ? (
        <SandboxNetworkSection agentId={agent.id} header={header} />
      ) : section === "environment" ? (
        <SandboxEnvSection agentId={agent.id} header={header} />
      ) : section === "channels" ? (
        <SandboxChannelsSection agentId={agent.id} />
      ) : section === "chat-forms" ? (
        <SandboxChatFormsSection agentId={agent.id} />
      ) : section === "skills" ? (
        <SandboxSkillsSection agent={agent} />
      ) : section === "schedules" ? (
        <SandboxSchedulesSection agentId={agent.id} />
      ) : section === "artifacts" ? (
        <SandboxArtifactsSection agentId={agent.id} />
      ) : section === "environments" ? (
        <SandboxEnvironmentsSection agentId={agent.id} header={header} />
      ) : section === "usage" ? (
        <SandboxUsageSection agentId={agent.id} />
      ) : (
        <ConnectionsSection
          agentId={agent.id}
          oauthReturnView={routeToPath({
            view: "sandbox-home",
            agentId: agent.id,
            sandboxSection: "connections",
          })}
          inset
        />
      )}
    </SandboxTwoColumnShell>
  );
}
