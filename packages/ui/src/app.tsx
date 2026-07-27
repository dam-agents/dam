import { useEffect } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { ListView } from "./modules/agents/views/list-view.js";
import { InboxView } from "./modules/approvals/views/inbox-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { ExperimentDetailView } from "./modules/experiments/views/experiment-detail-view.js";
import { ExperimentWizardView } from "./modules/experiments/views/experiment-wizard-view.js";
import { ExperimentsListView } from "./modules/experiments/views/experiments-list-view.js";
import { useFeatures } from "./modules/features/api/queries.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { KnowledgeBaseCreateView } from "./modules/knowledge-bases/views/knowledge-base-create-view.js";
import { KnowledgeBasesListView } from "./modules/knowledge-bases/views/knowledge-bases-list-view.js";
import { useFirstRunRedirect } from "./modules/sandboxes/hooks/use-first-run-redirect.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
import { SandboxWizardView } from "./modules/sandboxes/views/sandbox-wizard-view.js";
import { ChatView } from "./modules/sessions/views/chat-view.js";
import { SettingsView } from "./modules/settings/views/settings-view.js";
import { SlackBindView } from "./modules/slack/views/slack-bind-view.js";
import { TelegramBindView } from "./modules/telegram/views/telegram-bind-view.js";
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
  if (view === "telegram-bind") return <TelegramBindView />;
  if (view === "slack-bind") return <SlackBindView />;
  return <MainApp />;
}

function MainApp() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  useAgentCrashToasts();
  useFirstRunRedirect();

  // Feature-gated destinations bounce to Home once the per-user flags are
  // known — deep links to disabled features never leave a dead view up.
  const { data: features } = useFeatures();
  useEffect(() => {
    if (!features) return;
    const experimentsView =
      view === "experiments" ||
      view === "experiment-new" ||
      view === "experiment-detail";
    if (experimentsView && !features.experiments) {
      setView("list");
    }
    const knowledgeBasesView =
      view === "knowledge-bases" ||
      view === "knowledge-base-new" ||
      view === "knowledge-base-chat" ||
      view === "knowledge-base-config";
    if (knowledgeBasesView && !features["knowledge-bases"]) {
      setView("list");
    }
  }, [features, view, setView]);

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
      const state = pathToState(window.location.pathname);
      if (state.view === "chat") return enterChat(state.agent!);
      if (state.view === "knowledge-base-chat") {
        useStore.getState().resetChatContext();
        useStore.setState({
          selectedAgent: state.agent!,
          view: "knowledge-base-chat",
        });
        return;
      }
      // Unknown paths resolve to "list"; leaveChat also tears down chat context.
      if (state.view === "list") return leaveChat();
      useStore.setState({
        view: state.view,
        agentId: state.agentId ?? null,
        experimentId: state.experimentId ?? null,
        settingsTab: state.settingsTab ?? "account",
        sandboxSection: state.sandboxSection ?? "setup",
      });
    };
    onPopState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Chat owns its mobile sessions/chat nav, so the rail hides its bottom bar
  // here. A knowledge base's standalone page is the same chat surface under
  // its own route, so it shares the shell.
  if (view === "chat" || view === "knowledge-base-chat")
    return (
      <>
        <div className="flex h-dvh bg-background overflow-hidden">
          <IconRail hideMobileBar />
          <div className="relative z-10 flex-1 min-w-0">
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
        <main className="relative z-10 flex-1 overflow-y-auto">
          {view === "sandbox-new" ? (
            <SandboxWizardView />
          ) : view === "experiment-new" ? (
            <ExperimentWizardView />
          ) : view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "knowledge-base-new" ? (
            <KnowledgeBaseCreateView />
          ) : view === "knowledge-base-config" ? (
            <KnowledgeBaseConfigView />
          ) : (
            <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
              {view === "settings" ? (
                <SettingsView />
              ) : view === "inbox" ? (
                <InboxView />
              ) : view === "experiments" ? (
                <ExperimentsListView />
              ) : view === "experiment-detail" ? (
                <ExperimentDetailView />
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
