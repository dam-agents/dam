import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { DocsLinkHelpIcon } from "./components/docs-link.js";
import { IconRail } from "./components/icon-rail.js";
import { InlineFormattingShowcase } from "./components/inline-formatting-showcase.js";
import { StartupStatesShowcase } from "./components/startup-states-showcase.js";
import { emitToast } from "./lib/toast.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ListView } from "./modules/agents/views/list-view.js";
import { InboxView } from "./modules/approvals/views/inbox-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { ExperimentsListView } from "./modules/experiments/views/experiments-list-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { KnowledgeBasesListView } from "./modules/knowledge-bases/views/knowledge-bases-list-view.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute } from "./modules/platform/lib/routes.js";
import { ConfigureExploration } from "./modules/sandboxes/components/configure-exploration.js";
import { useFirstRunRedirect } from "./modules/sandboxes/hooks/use-first-run-redirect.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { SandboxWizardView } from "./modules/sandboxes/views/sandbox-wizard-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { TelegramBindView } from "./modules/telegram/views/telegram-bind-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { useStore } from "./store.js";

class DevErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error)
      return (
        <div style={{ padding: 32, fontFamily: "monospace", fontSize: 14 }}>
          <h2 style={{ color: "red" }}>Render crash</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    return this.props.children;
  }
}

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

  // Must stay above the early returns: the terms/bind views render without
  // MainApp, and back/forward has to keep working there too.
  useBrowserHistory();

  // Apply theme on mount + listen for system preference changes
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

function MainApp() {
  const view = useStore((s) => s.view);
  useAgentCrashToasts();
  useFirstRunRedirect();

  useEffect(() => {
    const path = window.location.pathname;
    if (parseRoute(path).view === "sandbox-new") return;
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

  // Temporary mock-only exploration routes — delete after design review
  if (
    import.meta.env.VITE_MOCK &&
    window.location.pathname === "/explore/configure"
  ) {
    return (
      <div className="flex h-dvh bg-background overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <ConfigureExploration />
        </main>
      </div>
    );
  }

  if (
    import.meta.env.VITE_MOCK &&
    window.location.pathname === "/explore/inline-formatting"
  ) {
    return (
      <div className="flex h-dvh bg-background overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <InlineFormattingShowcase />
        </main>
      </div>
    );
  }

  if (
    import.meta.env.VITE_MOCK &&
    window.location.pathname === "/explore/startup-states"
  ) {
    return (
      <div className="flex h-dvh bg-background overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <StartupStatesShowcase />
        </main>
      </div>
    );
  }

  // Chat owns its mobile sessions/chat nav, so the rail hides its bottom bar
  // here. A knowledge base's standalone page is the same chat surface under
  // its own route, so it shares the shell.
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
      </>
    );

  // All non-chat views share the icon-rail shell
  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          <div className="fixed bottom-6 right-6 z-10">
            <DocsLinkHelpIcon />
          </div>
          {view === "sandbox-new" ? (
            <SandboxWizardView />
          ) : view === "sandbox-home" ? (
            <DevErrorBoundary>
              <SandboxHomeView />
            </DevErrorBoundary>
          ) : view === "knowledge-base-config" ? (
            <KnowledgeBaseConfigView />
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
              {view === "home" ? (
                <HomeView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "inbox" ? (
                <InboxView />
              ) : view === "experiments" ? (
                <ExperimentsListView />
              ) : view === "knowledge-bases" ? (
                <KnowledgeBasesListView />
              ) : view === "artifacts" ? (
                <ArtifactsView />
              ) : (
                <ListView />
              )}
            </div>
          )}
        </main>
      </div>
      <DialogOverlay />
      <ConnectionBanner />
    </div>
  );
}
