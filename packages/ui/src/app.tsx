import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { GlobalBanner } from "./components/global-banner.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { AgentCardGallery } from "./mock/data/agent-card-gallery.js";
import { ComponentShowcase } from "./mock/data/component-showcase.js";
import { FlowScreen, NavFlows } from "./mock/nav-flows.js";
import { PlaceholderTexts } from "./mock/placeholder-texts.js";
import { SidebarSpecs } from "./mock/sidebar-specs.js";
import { MockStateBar } from "./mock/state-bar.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { AgentLandingView } from "./modules/agents/views/agent-landing-view.js";
import { AgentSetupView } from "./modules/agents/views/agent-setup-view.js";
import { SetupWorkbenchView } from "./modules/agents/views/setup-workbench-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { NotificationsPanel } from "./modules/notifications/components/notifications-panel.js";
import { useApprovalToasts } from "./modules/notifications/hooks/use-approval-toasts.js";
import { PacksView } from "./modules/packs/views/packs-view.js";
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

const isMock = import.meta.env.VITE_MOCK === "true";

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
  if (view === "nav-flows") return <NavFlows />;
  if (view === "placeholder-texts") return <PlaceholderTexts />;
  if (view === "flow-screen") return <FlowScreen />;
  return (
    <>
      <MainApp />
      {isMock && <MockStateBar />}
    </>
  );
}

const SETUP_VIEWS = new Set<Route["view"]>(["agent-new"]);

function MainApp() {
  const view = useStore((s) => s.view);
  const notificationsOpen = useStore((s) => s.notificationsOpen);
  const setNotificationsOpen = useStore((s) => s.setNotificationsOpen);

  useLiveEvents();
  useAgentCrashToasts();
  useApprovalToasts();

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
        <div className="flex flex-col h-full bg-background overflow-hidden">
          {!isMock && <GlobalBanner />}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <IconRail hideMobileBar />
            <div className="relative z-content flex-1 min-w-0">
              <ChatView />
            </div>
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
      {!isMock && <GlobalBanner />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          {view === "agent-landing" ? (
            <div className="mx-auto w-full max-w-[960px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <AgentLandingView />
            </div>
          ) : view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "home" ? (
            <HomeView />
          ) : view === "packs" ? (
            <div className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              <PacksView />
            </div>
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
          ) : view === "sidebar-specs" ? (
            <div className="w-full px-6 py-6 pb-20">
              <SidebarSpecs />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 py-4 pb-20 md:px-[5%] md:py-6 md:pb-10">
              {view === "agent-new" ? (
                <AgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "card-gallery" ? (
                <AgentCardGallery />
              ) : view === "component-showcase" ? (
                <ComponentShowcase />
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
