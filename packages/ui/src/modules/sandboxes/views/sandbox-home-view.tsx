import type { PendingRestart } from "agent-runtime-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { ChatFormSettings } from "../../a2ui/components/chat-form-settings.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import { useAgents, useIsAgentInaccessible } from "../../agents/api/queries.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { useHarnessConfigWatch } from "../../agents/hooks/use-harness-config-watch.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import { routeToPath, type SandboxSection } from "../../platform/lib/routes.js";
import { useProcesses } from "../../processes/api/queries.js";
import { useApplyPendingRestartWithConfirm } from "../../processes/components/pending-restart-banner.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { AgentManagementActions } from "../components/agent-management-actions.js";
import { AgentUsageActions } from "../components/agent-usage-actions.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { SandboxChannelsSection } from "../components/sandbox-channels-section.js";
import {
  SandboxHomeHeader,
  SandboxIdentity,
  type SectionHeaderSlot,
} from "../components/sandbox-home-header.js";
import { SandboxProvidersSection } from "../components/sandbox-providers-section.js";
import {
  SandboxSectionNav,
  SECTIONS,
} from "../components/sandbox-section-nav.js";
import { SandboxSetupSection } from "../components/sandbox-setup-section.js";
import { SandboxSkillsSection } from "../components/sandbox-skills-section.js";
import { ConnectionAddressingSection } from "../components/setup/setup-sections.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";

const SECTIONS_WITH_ACTIONS: ReadonlySet<SandboxSection> = new Set([
  "providers",
  "connections",
  "network",
  "environment",
  "schedules",
]);

export function SandboxHomeView() {
  const agentId = useStore((s) => s.agentId);
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const agentsQuery = useAgents();
  const agent = agentId
    ? (agentsQuery.data?.list.find((a) => a.id === agentId) ?? null)
    : null;

  const agentInaccessible = useIsAgentInaccessible(agentId);
  usePublicAgentFallback(agentId, agentInaccessible);

  const display = useResolvedAgentDisplay(agent);
  useHarnessConfigWatch(agentId);

  const { summaries, warnings } = useSectionSummaries(agent);
  const chatFormsEnabled = useChatFormsEnabled();
  const sections = chatFormsEnabled
    ? SECTIONS
    : SECTIONS.filter((e) => e.section !== "chat-forms");
  const sectionEntry = SECTIONS.find((e) => e.section === section);
  const SectionPictogram = sectionEntry?.pictogram;

  const header: SectionHeaderSlot = (actions) =>
    agent && (
      <SandboxHomeHeader
        agent={agent}
        title={sectionEntry?.title ?? ""}
        description={sectionEntry?.description}
        pictogram={SectionPictogram && <SectionPictogram aria-hidden />}
        actions={actions}
      />
    );

  if (!agent || !display) {
    return (
      <div>
        {!agentId && (
          <p className="text-sm text-muted-foreground">No agent selected.</p>
        )}
        {agentId && agentsQuery.data !== undefined && !agent && (
          <p className="text-sm text-muted-foreground">Agent not found.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10 md:pt-5">
        <SandboxSectionNav
          sections={sections}
          header={<SandboxIdentity agent={agent} display={display} />}
          active={section}
          onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
          summaries={summaries}
          warnings={warnings}
        />
        <div className="min-w-0 flex-1 md:max-w-[760px]">
          {!SECTIONS_WITH_ACTIONS.has(section) && header()}
          {section === "setup" ? (
            <>
              <AgentUsageActions agent={agent} />
              <SandboxSetupSection agent={agent} />
              <AgentManagementActions agent={agent} display={display} />
            </>
          ) : section === "providers" ? (
            <SandboxProvidersSection agentId={agent.id} header={header} />
          ) : section === "network" ? (
            <AgentEgressEditor agentId={agent.id} header={header} />
          ) : section === "environment" ? (
            <EnvTab agent={agent} header={header} />
          ) : section === "channels" ? (
            <SandboxChannelsSection agentId={agent.id} />
          ) : section === "chat-forms" ? (
            <ChatFormSettings agentId={agent.id} />
          ) : section === "skills" ? (
            <SandboxSkillsSection agent={agent} />
          ) : section === "schedules" ? (
            <SchedulesPanel
              agentId={agent.id}
              header={header}
              onResumeSession={(sessionId) =>
                openAgentSession(agent.id, sessionId)
              }
            />
          ) : section === "usage" ? (
            <SandboxUsageSection agentId={agent.id} />
          ) : (
            <>
              <ConnectionsSection
                agentId={agent.id}
                header={header}
                leading={<ConnectionAddressingSection agent={agent} />}
                oauthReturnView={routeToPath({
                  view: "sandbox-home",
                  agentId: agent.id,
                  sandboxSection: "connections",
                })}
              />
            </>
          )}
        </div>
      </div>
      <PendingRestartBar agentId={agent.id} />
    </>
  );
}

function PendingRestartBar({ agentId }: { agentId: string }) {
  const { data } = useProcesses(agentId, { enabled: true, poll: true });
  if (!data?.pendingRestart) return null;
  return <RestartBar agentId={agentId} pendingRestart={data.pendingRestart} />;
}

function RestartBar({
  agentId,
  pendingRestart,
}: {
  agentId: string;
  pendingRestart: PendingRestart;
}) {
  const restart = useApplyPendingRestartWithConfirm(agentId, pendingRestart);
  return (
    <div
      className="sticky bottom-0 mt-8 border-t border-border bg-background"
      data-testid="pending-restart-bar"
    >
      <div className="flex items-center justify-end gap-3 py-3">
        <p className="text-sm text-muted-foreground">
          Changes need agent restart to fully apply.
        </p>
        <Button disabled={restart.pending} onClick={() => void restart.apply()}>
          Restart now
        </Button>
      </div>
    </div>
  );
}
