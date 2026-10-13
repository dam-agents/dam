import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { GettingStartedDock } from "./modules/getting-started/components/getting-started-dock.js";
import {
  ActivityButton,
  NotificationsPanel,
} from "./modules/home/components/notifications-panel.js";
import { useApprovalToasts } from "./modules/home/hooks/use-approval-toasts.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute } from "./modules/platform/lib/routes.js";
import { isDarkTheme } from "./modules/platform/store/theme.js";
import { NotFoundView } from "./modules/platform/views/not-found-view.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { BrowseKitsModal } from "./modules/starter-kits/components/browse-kits-modal.js";
import { StarterKitDetailView } from "./modules/starter-kits/views/starter-kit-view.js";
import { TelegramBindView } from "./modules/telegram/views/telegram-bind-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { UsageReportView } from "./modules/usage/views/usage-report-view.js";
import { useStore } from "./store.js";

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

  useBrowserHistory();

  useEffect(() => {
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        isDarkTheme(useStore.getState().theme),
      );
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  if (view === "terms") return <TermsView />;
  if (view === "telegram-bind")
    return (
      <>
        <TelegramBindView />
        <DialogOverlay />
      </>
    );
  if (view === "slack-bind")
    return (
      <>
        <SlackBindView />
        <DialogOverlay />
      </>
    );
  if (view === "analytics") return <UsageReportView />;
  return <MainApp />;
}

function MainApp() {
  const view = useStore((s) => s.view);
  const activityOpen = useStore((s) => s.activityView !== null);
  const setActivityView = useStore((s) => s.setActivityView);
  const kitBrowserOpen = useStore((s) => s.kitBrowserOpen);

  useLiveEvents();
  useAgentCrashToasts();
  useApprovalToasts();

  useEffect(() => {
    const path = window.location.pathname;
    if (parseRoute(path).view === "starter-kit") return;
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
                <ActivityButton onOpen={() => setActivityView("feed")} />
              </div>
            </div>
            <ChatView />
          </div>
        </div>
        {activityOpen && (
          <NotificationsPanel onClose={() => setActivityView(null)} />
        )}
        {kitBrowserOpen && <BrowseKitsModal />}
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex flex-1 flex-col overflow-y-auto">
          <div className="pointer-events-none sticky top-0 z-raised flex justify-end px-4 pt-3 md:px-6">
            <div className="pointer-events-auto">
              <ActivityButton onOpen={() => setActivityView("feed")} />
            </div>
          </div>
          <div
            className={cn(
              "mx-auto w-full flex-1 px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10",
              view === "home" || view === "starter-kit"
                ? "max-w-[1200px]"
                : view === "settings" || view === "sandbox-home"
                  ? "max-w-[1040px]"
                  : "max-w-[960px]",
            )}
          >
            {view === "sandbox-home" ? (
              <SandboxHomeView />
            ) : view === "home" || view === "starter-kit" ? (
              <>
                <HomeView />
                {view === "starter-kit" && <StarterKitDetailView />}
              </>
            ) : view === "settings" ? (
              <SettingsView />
            ) : view === "artifacts" ? (
              <ArtifactsView />
            ) : (
              <NotFoundView />
            )}
          </div>
        </main>
      </div>
      {activityOpen && (
        <NotificationsPanel onClose={() => setActivityView(null)} />
      )}
      {kitBrowserOpen && <BrowseKitsModal />}
      <DialogOverlay />
      <ConnectionBanner />
      <GettingStartedDock placement="page" />
    </div>
  );
}
