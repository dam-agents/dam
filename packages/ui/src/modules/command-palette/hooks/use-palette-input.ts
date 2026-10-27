import type { ApprovalView } from "api-server-api";
import { useMemo } from "react";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import { useAgents } from "../../agents/api/queries.js";
import { deniableApprovalIds } from "../../approvals/lib/deny-all.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { useChangeSets } from "../../changes/api/queries.js";
import { hasGitRepositories } from "../../changes/lib/availability.js";
import { useEnvironmentsEnabled } from "../../environments/api/queries.js";
import { useGettingStarted } from "../../getting-started/api/queries.js";
import { deriveChecklist } from "../../getting-started/lib/derive-checklist.js";
import { useAttention, useFeed } from "../../home/api/queries.js";
import { useDismissals } from "../../home/hooks/use-dismissals.js";
import { SECTIONS } from "../../sandboxes/components/sandbox-section-nav.js";
import { useAgentSession } from "../../sessions/api/queries.js";
import { useSettingsTabs } from "../../settings/hooks/use-settings-tabs.js";
import { useStarterKits } from "../../starter-kits/api/queries.js";
import type { PaletteInput } from "../lib/palette-command.js";
import {
  indexedArtifactSchema,
  indexedSessionSchema,
  SNAPSHOT_CAP,
  TITLE_MAX,
} from "../lib/palette-storage.js";
import { useCachedList } from "./use-palette-storage.js";

const NO_APPROVALS: readonly ApprovalView[] = [];

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the palette indexes, read while it is open:
 * the page the person is on, their agents and recent sessions, the artifact
 * library, the starter kits, the settings tabs they see and the approvals
 * waiting. Sessions and artifacts come from this browser's stored copy until
 * the server answers.
 */
export function usePaletteInput(): PaletteInput {
  const view = useStore((s) => s.view);
  const agentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const chatAgentId = view === "chat" ? agentId : null;
  const section = useStore((s) => s.sandboxSection);
  const sessionId = useStore((s) => (s.view === "chat" ? s.sessionId : null));
  const settingsTab = useStore((s) => s.settingsTab);
  const theme = useStore((s) => s.theme);
  const showSleeping = useStore((s) => s.sidebarShowHibernating);
  const approvalsOpen = useStore((s) => s.sidePanelTab === "approvals");
  const dock = useStore((s) => s.dock);
  const restarting = useStore((s) => s.restartingAgents);
  const checklistExpanded = useStore((s) => s.checklistExpanded);

  const agentsData = useAgents().data;
  const attention = useAttention().data;
  const artifactList = useArtifacts({}).data;
  const kits = useStarterKits().data;
  const { tabs } = useSettingsTabs();
  const chatForms = useChatFormsEnabled();
  const environments = useEnvironmentsEnabled();
  const openSession = useAgentSession(chatAgentId, sessionId).data ?? null;
  const changeSets = useChangeSets(chatAgentId, sessionId);
  const { items: feed } = useFeed();
  const { isDismissed } = useDismissals();
  const progress = useGettingStarted().data;
  const checklist = progress ? deriveChecklist(progress) : null;

  const freshSessions = useMemo(
    () =>
      attention?.items.slice(0, SNAPSHOT_CAP).map((item) => ({
        agentId: item.agentId,
        sessionId: item.sessionId,
        title: item.title?.slice(0, TITLE_MAX) ?? null,
        mode: item.mode,
        activityAt: Date.parse(item.activityAt ?? item.createdAt),
      })),
    [attention],
  );
  const freshArtifacts = useMemo(
    () =>
      artifactList?.slice(0, SNAPSHOT_CAP).map((artifact) => ({
        id: artifact.id,
        title: artifact.title.slice(0, TITLE_MAX),
        agentId: artifact.agentId,
      })),
    [artifactList],
  );
  const sessions = useCachedList(
    "sessions",
    indexedSessionSchema,
    freshSessions,
  );
  const artifacts = useCachedList(
    "artifacts",
    indexedArtifactSchema,
    freshArtifacts,
  );

  const ownAgents = agentsData?.list ?? [];
  const agents = [...ownAgents, ...(agentsData?.shared ?? [])];
  const chatAgent = agents.find((a) => a.id === chatAgentId) ?? null;
  const pendingApprovals = feed.flatMap((item) =>
    item.kind === "approval" && !isDismissed(item) ? [item.approval] : [],
  );

  return {
    route: {
      view,
      agentId,
      section: view === "sandbox-home" ? section : null,
      sessionId,
      settingsTab: view === "settings" ? settingsTab : null,
    },
    agents,
    ownAgents,
    restarting,
    sessions,
    openSession,
    artifacts,
    kits: kits ?? [],
    settingsTabs: tabs,
    sections: SECTIONS.filter(
      (e) =>
        (chatForms || e.section !== "chat-forms") &&
        (environments || e.section !== "environments"),
    ),
    channels: agentsData?.availableChannels ?? {},
    browserOpen: chatAgent?.requireConnectionAddress
      ? dock?.kind === "browser" && dock.agentId === chatAgent.id
      : null,
    changesOpen:
      chatAgent && hasGitRepositories(changeSets) !== false
        ? dock?.kind === "changes" && dock.agentId === chatAgent.id
        : null,
    theme,
    showSleeping,
    approvalsOpen,
    checklist:
      checklist === null || checklist.complete
        ? null
        : checklistExpanded && !checklist.dismissed
          ? "open"
          : "closed",
    pendingApprovals:
      deniableApprovalIds(pendingApprovals).length > 0
        ? pendingApprovals
        : NO_APPROVALS,
    brandShort: getBrand().short,
  };
}
