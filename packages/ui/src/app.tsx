import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { StarterKitSetupView } from "./modules/agents/views/agent-create-view.js";
import { CodingAgentSetupView } from "./modules/agents/views/coding-agent-setup-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import {
  NotificationsBell,
  NotificationsPanel,
} from "./modules/home/components/notifications-panel.js";
import { useApprovalToasts } from "./modules/home/hooks/use-approval-toasts.js";
import { usePodSessionsWatch } from "./modules/home/hooks/use-pod-sessions-watch.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute, type Route } from "./modules/platform/lib/routes.js";
import { PendingBindModal } from "./modules/sandboxes/components/channels/pending-bind-modal.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { StarterKitDetailView } from "./modules/starter-kits/views/starter-kit-view.js";
import { StarterKitsView } from "./modules/starter-kits/views/starter-kits-view.js";
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

const SETUP_VIEWS = new Set<Route["view"]>(["agent-new", "starter-kit-new"]);

function MainApp() {
  const view = useStore((s) => s.view);
  const activityOpen = useStore((s) => s.activityOpen);
  const setActivityOpen = useStore((s) => s.setActivityOpen);

  useLiveEvents();
  useAgentCrashToasts();
  useApprovalToasts();
  usePodSessionsWatch();

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

  if (view === "chat")
    return (
      <>
        <div className="flex h-dvh bg-background overflow-hidden">
          <IconRail hideMobileBar />
          <div className="relative z-content flex-1 min-w-0">
            <div className="pointer-events-none absolute top-0 right-0 z-raised px-4 pt-3 md:px-6">
              <div className="pointer-events-auto">
                <NotificationsBell onOpen={() => setActivityOpen(true)} />
              </div>
            </div>
            <ChatView />
          </div>
        </div>
        {activityOpen && (
          <NotificationsPanel onClose={() => setActivityOpen(false)} />
        )}
        <DialogOverlay />
        <PendingBindModal />
        <ConnectionBanner />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <div className="pointer-events-none sticky top-0 z-raised flex justify-end px-4 pt-3 md:px-6">
            <div className="pointer-events-auto">
              <NotificationsBell onOpen={() => setActivityOpen(true)} />
            </div>
          </div>
          {view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : (
            <div
              className={cn(
                "mx-auto w-full px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10",
                view === "home" ||
                  view === "starter-kits" ||
                  view === "starter-kit"
                  ? "max-w-[1200px]"
                  : "max-w-[960px]",
              )}
            >
              {view === "home" ? (
                <HomeView />
              ) : view === "agent-new" ? (
                <CodingAgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "starter-kits" || view === "starter-kit" ? (
                <>
                  <StarterKitsView />
                  {view === "starter-kit" && <StarterKitDetailView />}
                </>
              ) : view === "starter-kit-new" ? (
                <StarterKitSetupView />
              ) : view === "artifacts" ? (
                <ArtifactsView />
              ) : (
                <HomeView />
              )}
            </div>
          )}
        </main>
      </div>
      {activityOpen && (
        <NotificationsPanel onClose={() => setActivityOpen(false)} />
      )}
      <DialogOverlay />
      <PendingBindModal />
      <ConnectionBanner />
    </div>
  );
}
