import { useEffect } from "react";

import { ChangeIndex } from "./components/change-index.js";
import { ConnectionBanner } from "./components/connection-banner.js";
import {
  closeBindModal,
  useBindModalState,
} from "./modules/sandboxes/components/channels/bind-modal-state.js";
import { PostCreateBindModal } from "./modules/sandboxes/components/channels/post-create-bind-modal.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { DocsLauncher } from "./components/docs-launcher.js";
import { FloatingApprovalsPill } from "./components/floating-approvals-pill.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { CodingAgentSetupView } from "./modules/agents/views/coding-agent-setup-view.js";
import { CodingAgentsView } from "./modules/agents/views/coding-agents-view.js";
import { SlackCardsPreviewView } from "./modules/agents/views/slack-cards-preview-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { ExperimentSetupView } from "./modules/experiments/views/experiment-setup-view.js";
import { ExperimentsListView } from "./modules/experiments/views/experiments-list-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { KnowledgeBaseSetupView } from "./modules/knowledge-bases/views/knowledge-base-setup-view.js";
import { KnowledgeBasesListView } from "./modules/knowledge-bases/views/knowledge-bases-list-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
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
  if (view === "slack-cards-preview")
    return (
      <div className="min-h-dvh bg-background">
        <div className="mx-auto w-full max-w-[960px] px-4 py-6 md:px-[5%] md:py-10">
          <SlackCardsPreviewView />
        </div>
        <ChangeIndex />
      </div>
    );
  return (
    <>
      <MainApp />
      <ChangeIndex />
      <GlobalBindModal />
    </>
  );
}

const SETUP_VIEWS = new Set<Route["view"]>([
  "coding-agent-new",
  "experiment-new",
  "knowledge-base-new",
]);

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

  if (view === "chat" || view === "knowledge-base-chat")
    return (
      <>
        <div className="flex h-dvh bg-background overflow-hidden">
          <IconRail hideMobileBar />
          <div className="relative z-content flex-1 min-w-0">
            <ChatView />
          </div>
        </div>
        <DialogOverlay />
        <ConnectionBanner />
        <FloatingApprovalsPill />
        <DocsLauncher />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          {view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "knowledge-base-config" ? (
            <KnowledgeBaseConfigView />
          ) : (
            <div
              className={cn(
                "mx-auto w-full px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10",
                view === "home" ? "max-w-[1200px]" : "max-w-[960px]",
              )}
            >
              {view === "home" ? (
                <HomeView />
              ) : view === "coding-agent-new" ? (
                <CodingAgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "coding-agents" ? (
                <CodingAgentsView />
              ) : view === "experiments" ? (
                <ExperimentsListView />
              ) : view === "experiment-new" ? (
                <ExperimentSetupView />
              ) : view === "knowledge-base-new" ? (
                <KnowledgeBaseSetupView />
              ) : view === "knowledge-bases" ? (
                <KnowledgeBasesListView />
              ) : view === "artifacts" ? (
                <ArtifactsView />
              ) : (
                <HomeView />
              )}
            </div>
          )}
        </main>
      </div>
      <DialogOverlay />
      <ConnectionBanner />
      <FloatingApprovalsPill />
      <DocsLauncher />
    </div>
  );
}

function GlobalBindModal() {
  const { channels } = useBindModalState();
  if (!channels) return null;
  return <PostCreateBindModal channels={channels} onClose={closeBindModal} />;
}

