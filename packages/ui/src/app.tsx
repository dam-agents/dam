import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { DocsLauncher } from "./components/docs-launcher.js";
import { FloatingApprovalsPill } from "./components/floating-approvals-pill.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { AgentCardGallery } from "./mock/data/agent-card-gallery.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { AgentSetupView } from "./modules/agents/views/agent-setup-view.js";
import { SetupWorkbenchView } from "./modules/agents/views/setup-workbench-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { PresetsView } from "./modules/packs/views/presets-view.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute, type Route } from "./modules/platform/lib/routes.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { SchedulesView } from "./modules/schedules/views/schedules-view.js";
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
        <div className="flex h-full bg-background overflow-hidden">
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
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          {view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "knowledge-base-config" ? (
            <KnowledgeBaseConfigView />
          ) : view === "home" ? (
            <HomeView />
          ) : view === "presets" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
              <PresetsView />
            </div>
          ) : view === "schedules" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
              <SchedulesView />
            </div>
          ) : view === "artifacts" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
              <ArtifactsView />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
              {view === "agent-new" ? (
                <AgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "setup-workbench" ? (
                <SetupWorkbenchView />
              ) : view === "card-gallery" ? (
                <AgentCardGallery />
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
