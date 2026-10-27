import { useEffect } from "react";

import { getBrand } from "./brand.js";
import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { useIsDesktop } from "./hooks/use-is-desktop.js";
import { documentTitle } from "./lib/document-title.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { useAgent } from "./modules/agents/api/queries.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { useSyncRestartingAgents } from "./modules/agents/hooks/use-restart-agent.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { SignInFollowUp } from "./modules/connections/components/sign-in-follow-up.js";
import { ConnectionSecretView } from "./modules/connections/views/connection-secret-view.js";
import { GettingStartedDock } from "./modules/getting-started/components/getting-started-dock.js";
import { useApprovalToasts } from "./modules/home/hooks/use-approval-toasts.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import {
  ClassicPageActions,
  ClassicPagePanels,
} from "./modules/platform/components/classic-page-panels.js";
import { AppTopBar } from "./modules/platform/components/sidebar/app-top-bar.js";
import { MobileNavDrawer } from "./modules/platform/components/sidebar/mobile-nav-drawer.js";
import { Sidebar } from "./modules/platform/components/sidebar/sidebar.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute } from "./modules/platform/lib/routes.js";
import { applyTheme } from "./modules/platform/store/theme.js";
import { NotFoundView } from "./modules/platform/views/not-found-view.js";
import { ProviderOutageBanner } from "./modules/provider-status/components/provider-outage-banner.js";
import { SECTIONS } from "./modules/sandboxes/components/sandbox-section-nav.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { useAgentSession } from "./modules/sessions/api/queries.js";
import {
  AppSidePanelButtons,
  AppSidePanelHost,
} from "./modules/sessions/components/app-side-panel.js";
import { ChatRoute } from "./modules/sessions/views/chat-route.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { useStarterKit } from "./modules/starter-kits/api/queries.js";
import { BrowseKitsModal } from "./modules/starter-kits/components/browse-kits-modal.js";
import { StarterKitDetailView } from "./modules/starter-kits/views/starter-kit-view.js";
import { StarterKitsView } from "./modules/starter-kits/views/starter-kits-view.js";
import { TelegramBindView } from "./modules/telegram/views/telegram-bind-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { UsageReportView } from "./modules/usage/views/usage-report-view.js";
import { useStore } from "./store.js";

function useDocumentTitle() {
  const view = useStore((s) => s.view);
  const settingsTab = useStore((s) => s.settingsTab);
  const sandboxSection = useStore((s) => s.sandboxSection);
  const agentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : s.agentId,
  );
  const sessionId = useStore((s) => (s.view === "chat" ? s.sessionId : null));
  const kitCatalog = useStore((s) => s.starterKitCatalog);
  const kitId = useStore((s) => s.starterKitId);
  const agent = useAgent(agentId);
  const session = useAgentSession(agentId, sessionId).data;
  const kit = useStarterKit(kitCatalog, kitId).data;
  const title = documentTitle(
    {
      view,
      settingsTab,
      sandboxSectionTitle: SECTIONS.find((e) => e.section === sandboxSection)
        ?.title,
    },
    { agent: agent?.name, session: session?.title, kit: kit?.name },
    getBrand().name,
  );
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

  useBrowserHistory();

  useEffect(() => {
    if (
      view === "terms" ||
      view === "telegram-bind" ||
      view === "slack-bind" ||
      view === "connection-secret"
    )
      document.title = documentTitle(
        { view, settingsTab: "account" },
        {},
        getBrand().name,
      );
  }, [view]);

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
  if (view === "connection-secret") return <ConnectionSecretView />;
  if (view === "analytics") return <UsageReportView />;
  return <MainApp />;
}

function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
    >
      Skip to content
    </a>
  );
}

function MainApp() {
  const view = useStore((s) => s.view);
  const kitBrowserOpen = useStore((s) => s.kitBrowserOpen);
  const desktop = useIsDesktop();

  useLiveEvents();
  useSyncRestartingAgents();
  useDocumentTitle();
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
        <SkipLink />
        <div className="flex h-dvh bg-background overflow-hidden">
          <Sidebar />
          <main
            id="main"
            tabIndex={-1}
            className="relative z-content has-[[data-full-page]]:z-overlay flex-1 min-w-0 outline-none"
          >
            <ChatRoute />
          </main>
        </div>
        {kitBrowserOpen && <BrowseKitsModal />}
        <MobileNavDrawer />
        <SignInFollowUp />
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <SkipLink />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <AppSidePanelHost>
          <main
            id="main"
            tabIndex={-1}
            className="flex flex-1 min-w-0 flex-col overflow-y-auto [scrollbar-gutter:stable] outline-none"
          >
            {!desktop && (
              <AppTopBar actions={<AppSidePanelButtons withArtifacts />} />
            )}
            <ClassicPageActions />
            <div
              className={cn(
                "mx-auto w-full flex-1 px-4 md:px-[5%] py-6 md:py-10",
                view === "home" ||
                  view === "starter-kit" ||
                  view === "starter-kits" ||
                  view === "artifacts"
                  ? "max-w-[1200px]"
                  : view === "settings" || view === "sandbox-home"
                    ? "max-w-[1040px]"
                    : "max-w-[960px]",
              )}
            >
              <ProviderOutageBanner className="mb-6" />
              {view === "sandbox-home" ? (
                <SandboxHomeView />
              ) : view === "home" || view === "starter-kit" ? (
                <>
                  <HomeView />
                  {view === "starter-kit" && <StarterKitDetailView />}
                </>
              ) : view === "artifacts" ? (
                <ArtifactsView />
              ) : view === "starter-kits" ? (
                <StarterKitsView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : (
                <NotFoundView />
              )}
            </div>
          </main>
        </AppSidePanelHost>
      </div>
      {kitBrowserOpen && <BrowseKitsModal />}
      <ClassicPagePanels />
      <MobileNavDrawer />
      <SignInFollowUp />
      <DialogOverlay />
      <ConnectionBanner />
      <GettingStartedDock placement="page" />
    </div>
  );
}
