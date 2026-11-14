import type { PendingRestart } from "agent-runtime-api";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { ChatFormSettings } from "../../a2ui/components/chat-form-settings.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { holds, isLockedSection } from "../../agents/lib/agent-permissions.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import {
  useEnvironments,
  useEnvironmentsEnabled,
} from "../../environments/api/queries.js";
import { AgentEnvironmentsSection } from "../../environments/components/agent-environment-members.js";
import { environmentsShown } from "../../environments/lib/environments-tab.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { useProcesses } from "../../processes/api/queries.js";
import { useApplyPendingRestartWithConfirm } from "../../processes/components/pending-restart-banner.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";
import {
  AgentDescriptionSection,
  AgentModelSettingsSection,
} from "./agent-config-sections.js";
import { AgentManagementActions } from "./agent-management-actions.js";
import { AgentUsageActions } from "./agent-usage-actions.js";
import { ConnectionsSection } from "./connections-section.js";
import { PeopleSection } from "./people-section.js";
import { SandboxBrowserSection } from "./sandbox-browser-section.js";
import { SandboxChannelsSection } from "./sandbox-channels-section.js";
import {
  SandboxHomeHeader,
  SandboxIdentity,
  type SectionHeaderSlot,
} from "./sandbox-home-header.js";
import { SandboxProvidersSection } from "./sandbox-providers-section.js";
import { SandboxSectionNav, SECTIONS } from "./sandbox-section-nav.js";
import { SandboxSkillsSection } from "./sandbox-skills-section.js";

const SECTIONS_WITH_ACTIONS: ReadonlySet<SandboxSection> = new Set([
  "providers",
  "connections",
  "network",
  "browser",
  "environment",
  "schedules",
  "environments",
]);

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  section: SandboxSection;
  onNavigate: (section: SandboxSection) => void;
  onOpenSession: (sessionId: string) => void;
  oauthReturnView: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's configuration: the section navigation,
 * the open section (General with the Agent's editable identity), and the bar that asks
 * for a restart when a saved change needs one. The Agent's settings modal
 * shows it and keeps the open section in itself.
 */
export function AgentConfiguration({
  agent,
  display,
  section,
  onNavigate,
  onOpenSession,
  oauthReturnView,
}: Props) {
  const { summaries, warnings } = useSectionSummaries(agent);
  const environmentsEnabled = useEnvironmentsEnabled();
  const environments = useEnvironments(environmentsEnabled ? agent.id : null);
  const agentHasEnvironments = environmentsShown({
    enabled: environmentsEnabled,
    count: environments.data?.length,
  });
  const chatFormsEnabled = useChatFormsEnabled();
  const sections = SECTIONS.filter(
    (e) =>
      (chatFormsEnabled || e.section !== "chat-forms") &&
      (agentHasEnvironments || e.section !== "environments") &&
      (agent.requireConnectionAddress === true || e.section !== "browser"),
  );
  const locked = new Set(
    sections
      .map((e) => e.section)
      .filter((s) => isLockedSection(agent.access, s)),
  );
  const sectionEntry = SECTIONS.find((e) => e.section === section);

  const header: SectionHeaderSlot = (actions) => (
    <SandboxHomeHeader
      agent={agent}
      title={sectionEntry?.title ?? ""}
      description={sectionEntry?.description}
      actions={actions}
    />
  );

  const nav = (
    <SandboxSectionNav
      sections={sections}
      active={section}
      onNavigate={onNavigate}
      summaries={summaries}
      warnings={warnings}
      locked={locked}
    />
  );
  const content = (
    <>
      {section === "setup" && (
        <div className="mb-6" data-testid="agent-general-identity">
          <SandboxIdentity agent={agent} />
        </div>
      )}
      {!SECTIONS_WITH_ACTIONS.has(section) && header()}
      <SectionBody
        agent={agent}
        display={display}
        section={section}
        header={header}
        onOpenSession={onOpenSession}
        oauthReturnView={oauthReturnView}
      />
    </>
  );

  /* UNIT_BOUNDARY_DESCRIPTION: the design's two columns: the section list on the left, which scrolls on its own, and the open section on the right with its restart bar, which scrolls apart from it, so switching or scrolling a section never moves the list. The Agent's editable name and avatar sit at the top of General; the modal's banner shows them read-only. The section list, two lines a row as the design draws it, scrolls up and down on its own under the name when it does not fit, never sideways: its rows take the width left after its bar, which keeps 24 px of room from them in a stable gutter. The content column holds its own side padding and keeps room for its bar (scrollbar-gutter: stable), so the bar sits at the modal's edge, never on the content, and its appearing never shifts the layout. */
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div
        className="flex min-h-0 min-w-0 shrink-0 flex-col border-border md:w-[260px] md:border-r"
        data-testid="configure-agent-modal-nav"
      >
        <div
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-3 md:overflow-y-auto md:pr-6 md:[scrollbar-gutter:stable]"
          data-testid="configure-agent-modal-nav-scroll"
        >
          {nav}
        </div>
      </div>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-gutter:stable] md:px-8"
        data-testid="configure-agent-modal-content"
      >
        <div className="md:max-w-[760px]">
          {content}
          <PendingRestartBar agentId={agent.id} />
        </div>
      </div>
    </div>
  );
}

function SectionBody({
  agent,
  display,
  section,
  header,
  onOpenSession,
  oauthReturnView,
}: Omit<Props, "onNavigate"> & { header: SectionHeaderSlot }) {
  return match(section)
    .with("setup", () => (
      <>
        <AgentDescriptionSection agent={agent} />
        {holds(agent.access, "sessions") && <AgentUsageActions agent={agent} />}
        <AgentModelSettingsSection agentId={agent.id} />
        <AgentManagementActions agent={agent} display={display} />
      </>
    ))
    .with("people", () => <PeopleSection agent={agent} />)
    .with("providers", () => (
      <SandboxProvidersSection agentId={agent.id} header={header} />
    ))
    .with("connections", () => (
      <ConnectionsSection
        agentId={agent.id}
        header={header}
        oauthReturnView={oauthReturnView}
      />
    ))
    .with("network", () => (
      <AgentEgressEditor agentId={agent.id} header={header} />
    ))
    .with("browser", () => (
      <SandboxBrowserSection agentId={agent.id} header={header} />
    ))
    .with("environment", () => <EnvTab agent={agent} header={header} />)
    .with("channels", () => <SandboxChannelsSection agentId={agent.id} />)
    .with("chat-forms", () => <ChatFormSettings agentId={agent.id} />)
    .with("skills", () => <SandboxSkillsSection agent={agent} />)
    .with("schedules", () => (
      <SchedulesPanel
        agentId={agent.id}
        header={header}
        onResumeSession={onOpenSession}
      />
    ))
    .with("environments", () => (
      <AgentEnvironmentsSection agentId={agent.id} header={header} />
    ))
    .with("usage", () => <SandboxUsageSection agentId={agent.id} />)
    .exhaustive();
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
