import { useEffect, useState } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { useIsDesktop } from "./hooks/use-is-desktop.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { GettingStartedDock } from "./modules/getting-started/components/getting-started-dock.js";
import { ApprovalsButton } from "./modules/home/components/approvals-button.js";
import { ApprovalsPanel } from "./modules/home/components/approvals-panel.js";
import { useApprovalToasts } from "./modules/home/hooks/use-approval-toasts.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { AppTopBar } from "./modules/platform/components/sidebar/app-top-bar.js";
import { MobileNavDrawer } from "./modules/platform/components/sidebar/mobile-nav-drawer.js";
import { Sidebar } from "./modules/platform/components/sidebar/sidebar.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute } from "./modules/platform/lib/routes.js";
import { applyTheme } from "./modules/platform/store/theme.js";
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
    const apply = () => applyTheme(useStore.getState().theme);
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
  const approvalsOpen = useStore((s) => s.approvalsOpen);
  const setApprovalsOpen = useStore((s) => s.setApprovalsOpen);
  const kitBrowserOpen = useStore((s) => s.kitBrowserOpen);
  const desktop = useIsDesktop();
  const [dockSlot, setDockSlot] = useState<HTMLDivElement | null>(null);

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
          <Sidebar />
          <div className="relative z-content flex-1 min-w-0">
            <ChatView />
          </div>
        </div>
        {approvalsOpen && (
          <ApprovalsPanel onClose={() => setApprovalsOpen(false)} />
        )}
        {kitBrowserOpen && <BrowseKitsModal />}
        <MobileNavDrawer />
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="relative z-content flex flex-1 flex-col overflow-y-auto">
          {!desktop && (
            <AppTopBar
              actions={
                <>
                  <GettingStartedDock placement="header" />
                  <ApprovalsButton />
                </>
              }
            />
          )}
          <div
            className={cn(
              "mx-auto w-full flex-1 px-4 md:px-[5%] py-6 md:py-10",
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
        {desktop && (
          <>
            <div ref={setDockSlot} className="flex shrink-0 items-end" />
            <aside
              aria-label="Notifications"
              className="flex w-11 shrink-0 flex-col items-center justify-end gap-1 border-l border-border bg-background py-2"
            >
              <GettingStartedDock placement="rail" slot={dockSlot} />
              <ApprovalsButton />
            </aside>
          </>
        )}
      </div>
      {approvalsOpen && (
        <ApprovalsPanel onClose={() => setApprovalsOpen(false)} />
      )}
      {kitBrowserOpen && <BrowseKitsModal />}
      <MobileNavDrawer />
      <DialogOverlay />
      <ConnectionBanner />
    </div>
  );
}
