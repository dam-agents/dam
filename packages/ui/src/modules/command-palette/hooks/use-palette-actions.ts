import { SessionMode, type SessionView } from "api-server-api";

import { useCopy } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

import { logout } from "../../../auth.js";
import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { resolveCharacter } from "../../agents/components/avatar/agent-avatar.js";
import { useActWhenAwake } from "../../agents/hooks/use-act-when-awake.js";
import { useCreateDefaultAgent } from "../../agents/hooks/use-create-default-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { useDenyApprovals } from "../../approvals/hooks/use-deny-approvals.js";
import { useOpenArtifact } from "../../artifacts/hooks/use-open-artifact.js";
import { useOpenBrowser } from "../../browser/hooks/use-auto-open-browser.js";
import { useToggleChanges } from "../../changes/hooks/use-toggle-changes.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { useAgentManagement } from "../../sandboxes/hooks/use-agent-management.js";
import { useConfirmDeleteSession } from "../../sessions/hooks/use-confirm-delete-session.js";
import { useOpenSession } from "../../sessions/hooks/use-open-session.js";
import { useOpenSidePanel } from "../../sessions/hooks/use-open-side-panel.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import type { PaletteActions } from "../lib/palette-command.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what each palette command does, wired to the
 * app's own navigation, mutations and confirmations. It lives beside the
 * palette rather than inside it, because a command runs after the palette
 * closes, and a mutation started by a component that is gone drops its
 * success toast.
 */
export function usePaletteActions({
  onBind,
  onRenameSession,
}: {
  onBind: (messenger: BindMessenger) => void;
  onRenameSession: (agentId: string, session: SessionView) => void;
}): PaletteActions {
  const setView = useStore((s) => s.setView);
  const view = useStore((s) => s.view);
  const chatAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const setShowSleeping = useStore((s) => s.setSidebarShowHibernating);
  const setTheme = useStore((s) => s.setTheme);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const deleteSession = useStore((s) => s.deleteSession);
  const openSidePanel = useOpenSidePanel();
  const openSession = useOpenSession();
  const startSession = useStartSession();
  const defaultAgent = useCreateDefaultAgent();
  const openArtifact = useOpenArtifact();
  const openBrowser = useOpenBrowser();
  const toggleChanges = useToggleChanges();
  const { denyAll } = useDenyApprovals();
  const management = useAgentManagement();
  const { wake } = useWakeAgent();
  const updateAgent = useUpdateAgent();
  const actWhenAwake = useActWhenAwake(chatAgentId ?? "");
  const confirmDeleteSession = useConfirmDeleteSession();
  const { copy } = useCopy();

  return {
    goTo: setView,
    openDocs: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer"),
    createAgent: () =>
      defaultAgent.ready
        ? void defaultAgent.create()
        : emitToast({
            kind: "info",
            message: "Can't create an agent yet. Try again in a moment.",
          }),
    browseKits: () => setKitBrowserOpen(true),
    openKit: navigateToStarterKit,
    bind: onBind,
    setShowSleeping,
    openSettings: navigateToSettings,
    setTheme,
    logOut: () => void logout(),
    setApprovalsOpen: (open) =>
      open ? openSidePanel("approvals") : setSidePanelTab(null),
    denyAll: (approvals) => void denyAll(approvals),
    newSession: startSession,
    newTerminal: (agentId) =>
      openAgentSession(
        agentId,
        crypto.randomUUID(),
        SessionMode.Terminal,
        true,
      ),
    openSession: (s) => openSession(s.agentId, s.sessionId, s.mode),
    configure: navigateToSandboxHome,
    toggleBrowser: (agentId, open) =>
      open ? void openBrowser(agentId) : setOpenBrowser(null),
    toggleChanges: (agentId, open) => void toggleChanges(open ? agentId : null),
    renameAgent: (agent, name) =>
      updateAgent.mutate({
        id: agent.id,
        name,
        ...(agent.avatar
          ? {}
          : { avatar: resolveCharacter(agent.name, agent.avatar) }),
      }),
    wake: (agentId) => void wake(agentId),
    restart: (agent) => void management.restart(agent),
    toggleDisabled: (agent) => void management.toggleDisabled(agent),
    deleteAgent: (agent) => void management.remove(agent),
    leave: (agent) => void management.leave(agent),
    copy: (text, what) =>
      void copy(text).then((outcome) =>
        emitToast(
          outcome === "copied"
            ? { kind: "success", message: `Copied the ${what}` }
            : { kind: "error", message: `Couldn't copy the ${what}` },
        ),
      ),
    renameSession: (agentId, session) =>
      actWhenAwake(`rename:${session.sessionId}`, () =>
        onRenameSession(agentId, session),
      ),
    deleteSession: (agentId, session) =>
      void confirmDeleteSession(session).then(
        (confirmed) =>
          confirmed &&
          actWhenAwake(`delete:${session.sessionId}`, () =>
            deleteSession(session.sessionId, agentId),
          ),
      ),
    openArtifact: (id) => {
      if (view !== "chat" && view !== "artifacts") setView("artifacts");
      void openArtifact(id);
    },
  };
}
