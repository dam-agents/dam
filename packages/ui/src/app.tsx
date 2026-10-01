import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { DocsLauncher } from "./components/docs-launcher.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { AgentSetupView } from "./modules/agents/views/agent-setup-view.js";
import { AgentsView } from "./modules/agents/views/agents-view.js";
import { SetupWorkbenchView } from "./modules/agents/views/setup-workbench-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { AvatarSheetView } from "./modules/avatar-sheet/avatar-sheet-view.js";
import { GettingStartedDock } from "./modules/avatar-sheet/getting-started-checklist.js";
import { FlowBoardView } from "./modules/flow-board/flow-board-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { KnowledgeBaseSetupView } from "./modules/knowledge-bases/views/knowledge-base-setup-view.js";
import { KnowledgeBasesListView } from "./modules/knowledge-bases/views/knowledge-bases-list-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { PacksView } from "./modules/packs/views/packs-view.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute, type Route } from "./modules/platform/lib/routes.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { TelegramBindView } from "./modules/telegram/views/telegram-bind-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { useStore } from "./store.js";

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

  useBrowserHistory();

  useEffect(() => {
    const apply = () => {
      const t = useStore.getState().theme;
      const isDark =
        t === "dark" ||
        (t === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  if (view === "terms") return <TermsView />;
  if (view === "telegram-bind") return <TelegramBindView />;
  if (view === "slack-bind") return <SlackBindView />;
  return <MainApp />;
}

const SETUP_VIEWS = new Set<Route["view"]>(["agent-new"]);

function MainContent() {
  const view = useStore((s) => s.view);
  switch (view) {
    case "home":
      return <HomeView />;
    case "chat":
    case "knowledge-base-chat":
      return <ChatView />;
    case "agents":
      return <AgentsView />;
    case "agent-new":
      return <AgentSetupView />;
    case "settings":
      return <SettingsView />;
    case "sandbox-home":
      return <SandboxHomeView />;
    case "knowledge-bases":
      return <KnowledgeBasesListView />;
    case "knowledge-base-new":
      return <KnowledgeBaseSetupView />;
    case "knowledge-base-config":
      return <KnowledgeBaseConfigView />;
    case "artifacts":
      return <ArtifactsView />;
    case "packs":
      return <PacksView />;
    case "setup-workbench":
      return <SetupWorkbenchView />;
    case "avatar-sheet":
      return <AvatarSheetView />;
    default:
      return <HomeView />;
  }
}

function MainApp() {
  const view = useStore((s) => s.view);

  useLiveEvents();
  useAgentCrashToasts();

  useEffect(() => {
    const path = window.location.pathname;
    if (SETUP_VIEWS.has(parseRoute(path).view)) return;
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    if (!oauthResult) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauthResult === "error") {
      emitToast({
        kind: "error",
        message: `OAuth failed: ${params.get("message") ?? "Unknown error"}`,
      });
      return;
    }
    if (oauthResult === "success") {
      emitToast({
        kind: "success",
        message: "Connection authorized.",
      });
    }
  }, []);

  if (view === "flow-board")
    return (
      <>
        <FlowBoardView />
        <DialogOverlay />
      </>
    );

  return (
    <>
      <div className="flex h-full bg-background overflow-hidden">
        <IconRail hideMobileBar />
        <div className="relative z-content flex-1 min-w-0 overflow-y-auto">
          <MainContent />
        </div>
      </div>
      <GettingStartedDock />
      <DialogOverlay />
      <ConnectionBanner />
      <DocsLauncher />
    </>
  );
}
