import type { PendingRestart } from "agent-runtime-api";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ChatFormSettings } from "../../a2ui/components/chat-form-settings.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import {
  findAgent,
  useAgents,
  useIsAgentInaccessible,
} from "../../agents/api/queries.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { useHarnessConfigWatch } from "../../agents/hooks/use-harness-config-watch.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { holds, isLockedSection } from "../../agents/lib/agent-permissions.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import {
  useEnvironments,
  useEnvironmentsEnabled,
} from "../../environments/api/queries.js";
import { EnvironmentsSection } from "../../environments/components/environments-section.js";
import { environmentsShown } from "../../environments/lib/environments-tab.js";
import { useFeatures } from "../../features/api/queries.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import { routeToPath, type SandboxSection } from "../../platform/lib/routes.js";
import { useProcesses } from "../../processes/api/queries.js";
import { useApplyPendingRestartWithConfirm } from "../../processes/components/pending-restart-banner.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { configRedirectTab } from "../../sessions/lib/side-panel.js";
import { AgentManagementActions } from "../components/agent-management-actions.js";
import { AgentUsageActions } from "../components/agent-usage-actions.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { PeopleSection } from "../components/people-section.js";
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
import { useSectionSummaries } from "../hooks/use-section-summaries.js";

const SECTIONS_WITH_ACTIONS: ReadonlySet<SandboxSection> = new Set([
  "providers",
  "connections",
  "network",
  "environment",
  "schedules",
  "environments",
]);

export function SandboxHomeView() {
  const agentId = useStore((s) => s.agentId);
  const section = useStore((s) => s.sandboxSection);
  const openConfigTab = useStore((s) => s.openConfigTab);
  // UNIT_BOUNDARY_DESCRIPTION: only the install's answer moves the page, never the last value this browser stored, so a bookmark does not bounce to the chat while the flags load — or after the user turned the experiment off.
  const features = useFeatures();
  const rightToolbar =
    features.isSuccess && features.data?.["unified-right-toolbar"] === true;
  const agentsQuery = useAgents();
  const agent = agentId ? findAgent(agentsQuery.data, agentId) : null;
  // UNIT_BOUNDARY_DESCRIPTION: with the experiment on this page has no surface of its own, so a deep link or a bookmark replaces itself with the chat and opens the panel that holds the section; every knob keeps its home there. A reader who may not use the Agent's Sessions keeps this page, since the chat route sends them straight back here and the two would loop.
  useEffect(() => {
    const tab = configRedirectTab(rightToolbar, section);
    if (!agentId || tab === null) return;
    if (agent !== null && !holds(agent.access, "sessions")) return;
    openConfigTab(agentId, tab);
  }, [rightToolbar, agentId, section, openConfigTab, agent]);

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
  const agentId = agent.id;
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const features = useFeatures();
  const rightToolbar =
    features.isSuccess && features.data?.["unified-right-toolbar"] === true;

  const display = useResolvedAgentDisplay(agent);
  const newLayout = useNewLayout();
  useHarnessConfigWatch(agentId);

  const { summaries, warnings } = useSectionSummaries(agent);
  const chatFormsEnabled = useChatFormsEnabled();
  const environmentsEnabled = useEnvironmentsEnabled();
  const environments = useEnvironments(
    environmentsEnabled && agent ? agent.id : null,
    { poll: false },
  );
  const agentHasEnvironments = environmentsShown({
    enabled: environmentsEnabled,
    count: environments.data?.length,
  });
  const sections = SECTIONS.filter(
    (e) =>
      (chatFormsEnabled || e.section !== "chat-forms") &&
      (agentHasEnvironments || e.section !== "environments"),
  );
  const locked = new Set(
    sections
      .map((e) => e.section)
      .filter((s) => isLockedSection(agent.access, s)),
  );
  const sectionEntry = SECTIONS.find((e) => e.section === section);
  const SectionPictogram = sectionEntry?.pictogram;

  const header: SectionHeaderSlot = (actions) => (
    <SandboxHomeHeader
      agent={agent}
      title={sectionEntry?.title ?? ""}
      description={sectionEntry?.description}
      pictogram={SectionPictogram && <SectionPictogram aria-hidden />}
      actions={actions}
      showUpdate={!newLayout}
    />
  );

  // UNIT_BOUNDARY_DESCRIPTION: with the experiment on the page has no surface of its own except People, which no panel renders yet, and except the page of a reader who may not use the Agent's Sessions, for whom it is the only surface left.
  if (rightToolbar && section !== "people" && holds(agent.access, "sessions"))
    return null;
  if (!display) return null;

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-6 md:flex-row md:gap-10",
          newLayout && "md:pt-5",
        )}
      >
        <SandboxSectionNav
          sections={sections}
          header={<SandboxIdentity agent={agent} display={display} />}
          active={section}
          onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
          summaries={summaries}
          warnings={warnings}
          locked={locked}
        />
        <div className="min-w-0 flex-1 md:max-w-[760px]">
          {!SECTIONS_WITH_ACTIONS.has(section) && header()}
          {section === "setup" ? (
            <>
              {holds(agent.access, "sessions") && (
                <AgentUsageActions agent={agent} />
              )}
              <SandboxSetupSection agent={agent} />
              <AgentManagementActions agent={agent} display={display} />
            </>
          ) : section === "people" ? (
            <PeopleSection agent={agent} />
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
          ) : section === "environments" ? (
            <EnvironmentsSection agentId={agent.id} header={header} />
          ) : section === "usage" ? (
            <SandboxUsageSection agentId={agent.id} />
          ) : (
            <>
              <ConnectionsSection
                agentId={agent.id}
                header={header}
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
