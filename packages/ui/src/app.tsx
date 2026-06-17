import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ListView } from "./modules/agents/views/list-view.js";
import { InboxView } from "./modules/approvals/views/inbox-view.js";
import { useFirstRunRedirect } from "./modules/sandboxes/hooks/use-first-run-redirect.js";
import { SandboxSettingsView } from "./modules/sandboxes/views/sandbox-settings-view.js";
import { SandboxWizardView } from "./modules/sandboxes/views/sandbox-wizard-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { pathToState, useStore } from "./store.js";

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

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
  return <MainApp />;
}

function MainApp() {
  const view = useStore((s) => s.view);

  useAgentCrashToasts();
  useFirstRunRedirect();

  useEffect(() => {
    // The sandbox-creation wizard owns its own OAuth-return handling so it can
    // rehydrate the in-progress sandbox before the params are stripped.
    const path = window.location.pathname;
    if (path === "/sandboxes/new") return;
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

  // Browser back/forward
  useEffect(() => {
    const enterChat = (agentId: string) => {
      useStore.getState().resetChatContext();
      useStore.setState({ selectedAgent: agentId, view: "chat" });
    };
    const leaveChat = () => {
      useStore.getState().resetChatContext();
      useStore.setState({ selectedAgent: null, view: "list" });
    };
    const onPopState = () => {
      const path = window.location.pathname;
      if (path.startsWith("/chat/"))
        enterChat(decodeURIComponent(path.slice(6)));
      else if (path === "/settings" || path.startsWith("/settings/")) {
        const { settingsTab } = pathToState(path);
        useStore.setState({
          view: "settings",
          settingsTab: settingsTab ?? "account",
        });
      } else if (path === "/inbox") useStore.setState({ view: "inbox" });
      else if (path === "/terms") useStore.setState({ view: "terms" });
      else if (path === "/sandboxes/new")
        useStore.setState({ view: "sandbox-new", agentId: null });
      else if (/^\/sandboxes\/[^/]+$/.test(path))
        useStore.setState({
          view: "sandbox-settings",
          agentId: decodeURIComponent(path.slice("/sandboxes/".length)),
        });
      else leaveChat();
    };
    // Handle initial URL (e.g. direct link to /chat/foo) — setState to avoid pushing duplicate history
    const path = window.location.pathname;
    if (path.startsWith("/chat/")) enterChat(decodeURIComponent(path.slice(6)));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Chat view is full-screen (has its own layout)
  if (view === "chat")
    return (
      <>
        <ChatView />
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  // All non-chat views share the icon-rail shell
  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-10 flex-1 overflow-y-auto">
          {view === "sandbox-new" ? (
            <SandboxWizardView />
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
              {view === "settings" ? (
                <SettingsView />
              ) : view === "inbox" ? (
                <InboxView />
              ) : view === "sandbox-settings" ? (
                <SandboxSettingsView />
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
