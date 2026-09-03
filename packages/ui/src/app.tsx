import { useEffect, useState } from "react";

import { ConnectionBanner } from "./components/connection-banner.js";
import { DialogOverlay } from "./components/dialog-overlay.js";
import { DocsLauncher } from "./components/docs-launcher.js";
import { FloatingApprovalsPill } from "./components/floating-approvals-pill.js";
import { IconRail } from "./components/icon-rail.js";
import { emitToast } from "./lib/toast.js";
import { cn } from "./lib/utils.js";
import { queryClient } from "./query-client.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { CodingAgentSetupView } from "./modules/agents/views/coding-agent-setup-view.js";
import { CodingAgentsView } from "./modules/agents/views/coding-agents-view.js";
import { ArtifactsView } from "./modules/artifacts/views/artifacts-view.js";
import { ExperimentSetupView } from "./modules/experiments/views/experiment-setup-view.js";
import { ExperimentsListView } from "./modules/experiments/views/experiments-list-view.js";
import { HomeView } from "./modules/home/views/home-view.js";
import { ShowcaseView } from "./modules/home/views/showcase-view.js";
import { KnowledgeBaseConfigView } from "./modules/knowledge-bases/views/knowledge-base-config-view.js";
import { KnowledgeBaseSetupView } from "./modules/knowledge-bases/views/knowledge-base-setup-view.js";
import { KnowledgeBasesListView } from "./modules/knowledge-bases/views/knowledge-bases-list-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { parseRoute, type Route } from "./modules/platform/lib/routes.js";
import { SandboxHomeView } from "./modules/sandboxes/views/sandbox-home-view.js";
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

const SETUP_VIEWS = new Set<Route["view"]>([
  "coding-agent-new",
  "experiment-new",
  "knowledge-base-new",
]);

function MainApp() {
  const view = useStore((s) => s.view);

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
        <FloatingApprovalsPill />
        <DocsLauncher />
      </>
    );

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <IconRail />
        <main className="relative z-content flex-1 overflow-y-auto">
          {view === "sandbox-home" ? (
            <SandboxHomeView />
          ) : view === "knowledge-base-config" ? (
            <KnowledgeBaseConfigView />
          ) : (
            <div
              className={cn(
                "mx-auto w-full px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10",
                view === "home" ? "max-w-[1200px]" : "max-w-[960px]",
              )}
            >
              {view === "home" ? (
                <HomeView />
              ) : view === "coding-agent-new" ? (
                <CodingAgentSetupView />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "coding-agents" ? (
                <CodingAgentsView />
              ) : view === "experiments" ? (
                <ExperimentsListView />
              ) : view === "experiment-new" ? (
                <ExperimentSetupView />
              ) : view === "knowledge-base-new" ? (
                <KnowledgeBaseSetupView />
              ) : view === "knowledge-bases" ? (
                <KnowledgeBasesListView />
              ) : view === "artifacts" ? (
                <ArtifactsView />
              ) : view === "showcase" ? (
                <ShowcaseView />
              ) : (
                <HomeView />
              )}
            </div>
          )}
        </main>
      </div>
      <DialogOverlay />
      <ConnectionBanner />
      <FloatingApprovalsPill />
      <DocsLauncher />
      <ChangesIndex />
    </div>
  );
}

interface CachedAgents {
  list: { id: string; name: string; state: string; hibernationTimeoutMin: number }[];
  availableChannels: unknown[];
}

function getCachedAgents(): CachedAgents["list"] {
  const data = queryClient.getQueryData<CachedAgents>(["agents", "list-with-channels"]);
  return data?.list ?? [];
}

function ensureStartingAgent(): string | null {
  const data = queryClient.getQueryData<CachedAgents>(["agents", "list-with-channels"]);
  if (!data) return null;

  const already = data.list.find((a) => a.state === "starting");
  if (already) return already.id;

  const candidate = data.list.find(
    (a) => a.state === "running" && a.hibernationTimeoutMin > 0,
  );
  if (!candidate) return null;

  queryClient.setQueryData(["agents", "list-with-channels"], {
    ...data,
    list: data.list.map((a) =>
      a.id === candidate.id ? { ...a, state: "starting" } : a,
    ),
  });
  return candidate.id;
}

function ChangesIndex() {
  const [open, setOpen] = useState(false);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);

  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const items: {
    label: string;
    where: string;
    go: () => void;
  }[] = [
    {
      label: "Compute Widget Always On Hover",
      where: "Home — hover over the idle agent slot in the compute bar",
      go: () => setView("home"),
    },
    {
      label: "Startup overlay with always on prompt",
      where: "Opens a starting agent — resets one to starting if needed",
      go: () => {
        const id = ensureStartingAgent();
        if (id) selectAgent(id);
        else setView("home");
      },
    },
    {
      label: "Setup - Lifecycle",
      where: "New agent creation page — scroll to the Lifecycle section",
      go: () => setView("coding-agent-new"),
    },
    {
      label: "Configure page - Lifecycle",
      where: "Agent settings — scroll to the Lifecycle section",
      go: () => {
        const agentId = "a1b2c3d4-0001-4000-8000-000000000001";
        navigateToSandboxHome(agentId, "setup");
      },
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed right-5 bottom-5 z-50 flex h-10 items-center gap-2 rounded-full border border-foreground bg-card px-4 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
      >
        {open ? "Close" : "Changes index"}
      </button>

      {open && (
        <div className="fixed right-5 bottom-16 z-50 w-[360px] rounded-xl border border-border bg-card p-4 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <p className="text-sm font-semibold text-foreground mb-3">
            Never-hibernate discovery — all changes
          </p>
          <div className="space-y-1">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.go();
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="text-sm font-medium text-foreground">
                  {item.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {item.where}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
