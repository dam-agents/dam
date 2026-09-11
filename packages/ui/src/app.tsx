import { Notification } from "@carbon/icons-react";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { AgentCardGallery } from "./mock/data/agent-card-gallery.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { AgentSetupView } from "./modules/agents/views/agent-setup-view.js";
import { SetupWorkbenchView } from "./modules/agents/views/setup-workbench-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { useNotifications } from "./modules/notifications/api/queries.js";
import { NotificationsPanel } from "./modules/notifications/components/notifications-panel.js";
import { isNeedsYou } from "./modules/notifications/lib/notification-types.js";
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

function NotificationBell() {
  const toggleNotifications = useStore((s) => s.toggleNotifications);
  const { items } = useNotifications();
  const needsYouCount = items.filter(isNeedsYou).length;

  return (
    <button
      type="button"
      onClick={toggleNotifications}
      aria-label={
        needsYouCount > 0
          ? `Notifications, ${needsYouCount} pending`
          : "Notifications"
      }
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Notification size={16} />
      {needsYouCount > 0 && (
        <Badge
          variant="default"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-accent px-1 text-[10px] font-bold text-white hover:bg-accent"
        >
          {needsYouCount > 9 ? "9+" : needsYouCount}
        </Badge>
      )}
    </button>
  );
}

function MainApp() {
  const view = useStore((s) => s.view);
  const notificationsOpen = useStore((s) => s.notificationsOpen);
  const setNotificationsOpen = useStore((s) => s.setNotificationsOpen);

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

  if (view === "chat")
    return (
      <>
        <div className="flex h-full bg-background overflow-hidden">
          <IconRail hideMobileBar />
          <div className="relative z-content flex-1 min-w-0">
            <div className="pointer-events-none absolute top-0 right-0 z-10 px-4 pt-3 md:px-6">
              <div className="pointer-events-auto">
                <NotificationBell />
              </div>
            </div>
            <ChatView />
          </div>
        </div>
        <NotificationsPanel
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
        />
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <div className="pointer-events-none sticky top-0 z-10 flex justify-end px-4 pt-3 md:px-6">
            <div className="pointer-events-auto">
              <NotificationBell />
            </div>
          </div>
          {view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "home" ? (
            <HomeView />
          ) : view === "presets" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <PresetsView />
            </div>
          ) : view === "schedules" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <SchedulesView />
            </div>
          ) : view === "artifacts" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <ArtifactsView />
            </div>
          ) : view === "setup-workbench" ? (
            <div className="mx-auto w-full max-w-[1400px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <SetupWorkbenchView />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              {view === "agent-new" ? (
                <AgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "card-gallery" ? (
                <AgentCardGallery />
              ) : (
                <HomeView />
              )}
            </div>
          )}
        </main>
      </div>
      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
      <DialogOverlay />
      <ConnectionBanner />
    </div>
  );
}
