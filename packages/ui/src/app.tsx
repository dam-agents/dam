import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { SetupProgressBar } from "./components/setup-progress-bar.js";
import { emitToast } from "./lib/toast.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ListView } from "./modules/agents/views/list-view.js";
import { InboxView } from "./modules/approvals/views/inbox-view.js";
import { AgentEgressView } from "./modules/egress-rules/views/agent-egress-view.js";
import { SandboxWizardView } from "./modules/sandboxes/views/sandbox-wizard-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { V2App } from "./modules/v2/views/v2-app.js";
import { pathToState, useStore } from "./store.js";

export default function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);

  useAgentCrashToasts();

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

  useEffect(() => {
    // The v2 wizard and the sandbox-creation wizard own their own OAuth-return
    // handling so they can rehydrate the in-progress sandbox before the params
    // are stripped.
    const path = window.location.pathname;
    if (path.startsWith("/v2") || path === "/sandboxes/new") return;
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
      const sandboxMatch = path.match(/^\/v2\/([^/]+)$/);
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
      else if (path === "/v2")
        useStore.setState({ view: "v2-list", agentId: null });
      else if (path === "/v2/new")
        useStore.setState({ view: "v2-new", agentId: null });
      else if (sandboxMatch && path !== "/v2/new")
        useStore.setState({
          view: "v2-terminal",
          agentId: decodeURIComponent(sandboxMatch[1]!),
        });
      else if (path.startsWith("/agents/") && path.endsWith("/egress")) {
        const id = decodeURIComponent(
          path.slice("/agents/".length, -"/egress".length),
        );
        useStore.setState({ view: "agent-egress", agentId: id });
      } else leaveChat();
    };
    // Handle initial URL (e.g. direct link to /chat/foo) — setState to avoid pushing duplicate history
    const path = window.location.pathname;
    if (path.startsWith("/chat/")) enterChat(decodeURIComponent(path.slice(6)));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // v2 sandbox surface is shell-less (no sidebar / mobile nav)
  if (view === "v2-list" || view === "v2-new" || view === "v2-terminal")
    return (
      <>
        <V2App />
        <DialogOverlay />
      </>
    );

  // Chat view is full-screen (has its own layout)
  if (view === "chat")
    return (
      <>
        <ChatView />
        <DialogOverlay />
        <ConnectionBanner />
      </>
    );

  if (view === "terms")
    return (
      <>
        <TermsView />
      </>
    );

  // All non-chat views share the icon-rail shell
  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-10 flex-1 overflow-y-auto">
          <SetupProgressBar />
          {view === "sandbox-new" ? (
            <SandboxWizardView />
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
              {view === "settings" ? (
                <SettingsView />
              ) : view === "inbox" ? (
                <InboxView />
              ) : view === "agent-egress" ? (
                <AgentEgressView />
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
