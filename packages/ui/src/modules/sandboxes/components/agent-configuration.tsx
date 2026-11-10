import type { PendingRestart } from "agent-runtime-api";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { ChatFormSettings } from "../../a2ui/components/chat-form-settings.js";
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
import { ThinkingSetting } from "../../sessions/components/thinking-setting.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";
import {
  AgentDescriptionSection,
  AgentModelSettingsSection,
} from "./agent-config-sections.js";
import { AgentManagementActions } from "./agent-management-actions.js";
import { AgentUsageActions } from "./agent-usage-actions.js";
import { ConnectionsSection } from "./connections-section.js";
import { PeopleSection } from "./people-section.js";
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
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's configuration: the section navigation
 * with the Agent's editable identity, the open section, and the bar that asks
 * for a restart when a saved change needs one. The configuration page and the
 * modal over the chat both show it; each keeps the open section in its own
 * place, the page in the address and the modal in itself.
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
  const sections = SECTIONS.filter(
    (e) => agentHasEnvironments || e.section !== "environments",
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

  return (
    <>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <SandboxSectionNav
          sections={sections}
          header={<SandboxIdentity agent={agent} display={display} />}
          active={section}
          onNavigate={onNavigate}
          summaries={summaries}
          warnings={warnings}
          locked={locked}
        />
        <div className="min-w-0 flex-1 md:max-w-[760px]">
          {!SECTIONS_WITH_ACTIONS.has(section) && header()}
          <SectionBody
            agent={agent}
            display={display}
            section={section}
            header={header}
            onOpenSession={onOpenSession}
            oauthReturnView={oauthReturnView}
          />
        </div>
      </div>
      <PendingRestartBar agentId={agent.id} />
    </>
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
    .with("environment", () => <EnvTab agent={agent} header={header} />)
    .with("channels", () => <SandboxChannelsSection agentId={agent.id} />)
    .with("chat-forms", () => (
      <>
        <ChatFormSettings agentId={agent.id} />
        <ThinkingSetting />
      </>
    ))
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
