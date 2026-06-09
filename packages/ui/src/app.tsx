import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { emitToast } from "./lib/toast.js";
import { InboxView } from "./modules/approvals/views/inbox-view.js";
import { AgentEgressView } from "./modules/egress-rules/views/agent-egress-view.js";
import { RailShell } from "./modules/journey/components/rail-shell.js";
import { JourneyApp } from "./modules/journey/views/journey-app.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { TermsView } from "./modules/terms/views/terms-view.js";
import { useStore } from "./store.js";

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

  useEffect(() => {
    // The connections step owns its own OAuth-return handling so it can
    // rehydrate the in-progress sandbox before the params are stripped.
    if (window.location.pathname.startsWith("/new/connections")) return;
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
      useStore.setState({ selectedAgent: null, view: "new-landing" });
    };
    const onPopState = () => {
      const path = window.location.pathname;
      if (path.startsWith("/chat/"))
        enterChat(decodeURIComponent(path.slice(6)));
      else if (path === "/new/image")
        useStore.setState({ view: "new-image", agentId: null });
      else if (path === "/new/sandbox")
        useStore.setState({ view: "new-sandbox", agentId: null });
      else if (path === "/new/connections")
        useStore.setState({ view: "new-connections", agentId: null });
      else if (path === "/new/context")
        useStore.setState({ view: "new-context", agentId: null });
      else if (path === "/settings") useStore.setState({ view: "settings" });
      else if (path === "/inbox") useStore.setState({ view: "inbox" });
      else if (path === "/terms") useStore.setState({ view: "terms" });
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

  // The agent-creation journey owns its own chrome (icon rail + step nav).
  if (
    view === "new-landing" ||
    view === "new-image" ||
    view === "new-sandbox" ||
    view === "new-connections" ||
    view === "new-context"
  )
    return (
      <>
        <JourneyApp />
        <DialogOverlay />
        <ConnectionBanner />
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

  // Settings / Inbox / agent-egress: full-screen under the icon rail.
  return (
    <>
      <RailShell>
        {view === "settings" ? (
          <SettingsView />
        ) : view === "inbox" ? (
          <InboxView />
        ) : (
          <AgentEgressView />
        )}
      </RailShell>
      <DialogOverlay />
      <ConnectionBanner />
    </>
  );
}
