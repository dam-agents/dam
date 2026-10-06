import { OverflowMenuVertical, Send } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getBrand } from "../../brand.js";
import { IconRail } from "../../components/icon-rail.js";
import { agents as mockAgents } from "../../mock/data/agents.js";
import type { AgentView } from "../../types.js";
import { hashIndex } from "../agents/components/bee-avatar.js";
import {
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../agents/components/char-avatar.js";
import { CHARACTER_QUESTS } from "../agents/lib/character-unlocks.js";
import { AgentSetupView } from "../agents/views/agent-setup-view.js";
import { SidebarSection } from "../sessions/components/sidebar-section.js";
import {
  CatchBubble,
  CatchCelebration,
  CatchStageFrame,
  CatchStyles,
  ChecklistPanel,
  ChecklistPill,
  type CrewSlotData,
  type QuestRowData,
} from "./getting-started-checklist.js";

const FIRST_AGENT: AgentView = {
  ...mockAgents[0]!,
  id: "first-agent-demo",
  name: "my-first-agent",
  state: "running",
};
const FIRST_AVATAR: CharName =
  CHAR_NAMES[hashIndex(FIRST_AGENT.id, CHAR_NAMES.length)]!;
const TOTAL = CHARACTER_QUESTS.length;

function rows(firstDone: boolean, reward: CharName | null): QuestRowData[] {
  return CHARACTER_QUESTS.map((q, i) => ({
    ...q,
    reward: i === 0 ? reward : null,
    state: i === 0 && firstDone ? "done" : "todo",
  }));
}

function crew(caught: CharName[]): CrewSlotData[] {
  return CHAR_NAMES.map((_, i) => ({ name: caught[i] ?? null }));
}

export function AppFrame({
  id,
  agents,
  showActivity,
  height = 720,
  overlay,
  children,
}: {
  id?: string;
  agents?: AgentView[];
  showActivity?: boolean;
  height?: number;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="relative left-1/2 w-[min(1440px,calc(100vw-80px))] -translate-x-1/2 scroll-mt-6 overflow-hidden rounded-xl border-2 border-border"
    >
      <div className="flex bg-background" style={{ height }}>
        <IconRail
          expanded
          hideMobileBar
          agentsOverride={agents}
          showActivity={showActivity}
        />
        <main className="relative flex-1 overflow-y-auto">{children}</main>
      </div>
      {overlay && (
        <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-3 [&>*]:pointer-events-auto">
          {overlay}
        </div>
      )}
    </div>
  );
}

export function SetupColumn({
  clearDock,
  children,
}: {
  clearDock?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[960px] px-4 py-4 md:px-[5%] md:py-6",
        clearDock ? "pb-[400px] md:pb-[400px]" : "pb-20 md:pb-10",
      )}
    >
      {children}
    </div>
  );
}

function HomeEmptyScreen() {
  const brand = getBrand();
  return (
    <div className="flex h-full w-full items-center justify-center px-4 md:px-[5%]">
      <div className="w-full max-w-[1200px]">
        <div className="flex flex-col-reverse items-center gap-8 px-6 md:flex-row md:gap-12">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome to {brand.name}
            </h1>
            <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
              With {brand.name}, you can deploy automated assistants that handle
              tasks like reviewing PRs, summarizing tickets, and monitoring
              builds in the cloud 24/7. Connect your tools, schedule runs, and
              share securely with your team.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline">Browse Starter Kits</Button>
              <Button
                onClick={() =>
                  document
                    .getElementById("first-visit-screen")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                Create Agent
              </Button>
            </div>
          </div>
          <div className="shrink-0">
            <img
              src="/illustrations/home-empty-state.svg"
              alt=""
              className="h-[280px] w-[420px] object-contain lg:h-[360px] lg:w-[540px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatSessionMockup() {
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <div className="flex h-full">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
        <div className="flex h-11 items-center gap-2.5 border-b border-border px-3">
          <CharAvatar name={FIRST_AVATAR} state="running" className="size-7" />
          <span className="truncate text-sm font-semibold text-foreground">
            {FIRST_AGENT.name}
          </span>
          <span className="size-2 shrink-0 rounded-full bg-success" />
        </div>
        <SidebarSection
          title="Files"
          open={filesOpen}
          onToggle={() => setFilesOpen((o) => !o)}
        >
          {filesOpen && (
            <p className="px-3 py-4 text-sm text-muted-foreground">No files</p>
          )}
        </SidebarSection>
        <SidebarSection title="Artifacts" open onToggle={() => {}}>
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No artifacts yet
          </p>
        </SidebarSection>
      </div>

      <div className="flex flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-6">
          <span className="flex">
            <CharAvatar
              name={FIRST_AVATAR}
              state="running"
              className="size-7"
            />
          </span>
          <h1 className="text-sm font-bold text-foreground">
            {FIRST_AGENT.name}
          </h1>
          <span className="size-2 shrink-0 rounded-full bg-success" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Agent actions"
            className="ml-auto"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div className="flex flex-col items-end gap-1">
            <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">
              You
            </span>
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
              Help me set up a PR review workflow
            </div>
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="mb-0.5 flex items-center gap-2">
              <CharAvatar
                name={FIRST_AVATAR}
                state="running"
                className="size-6"
              />
              <span className="text-sm font-semibold text-foreground">
                {FIRST_AGENT.name}
              </span>
            </span>
            <div className="max-w-full whitespace-pre-line pl-8 text-sm text-foreground">
              {
                "I'll set up an automated PR review workflow for you. Let me start by looking at your repository configuration…"
              }
            </div>
          </div>
        </div>
        <div className="px-8 pb-6">
          <div className="mx-auto flex h-12 max-w-3xl items-center justify-between rounded-xl border border-border bg-card px-4 text-sm text-muted-foreground">
            Ask {FIRST_AGENT.name} to do something
            <Send size={16} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  note,
  action,
  children,
}: {
  n: number;
  title: string;
  note: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {n} · {title}
          </p>
          <p className="mt-0.5 max-w-[760px] text-sm text-muted-foreground">
            {note}
          </p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function CatchMomentOverlay({ replayKey }: { replayKey: number }) {
  if (replayKey > 0) {
    return (
      <CatchCelebration key={replayKey} name={FIRST_AVATAR} variant="first" />
    );
  }
  return (
    <div className="flex items-end gap-1">
      <CatchBubble variant="first" />
      <CatchStageFrame name={FIRST_AVATAR} stage="revealed" />
    </div>
  );
}

export function FirstAgentScreens() {
  const [catchReplay, setCatchReplay] = useState(0);
  const [revealReplay, setRevealReplay] = useState(0);

  return (
    <div className="flex flex-col gap-10">
      <CatchStyles />

      <Step
        n={1}
        title="Landing in DAM"
        note="A brand-new user lands on Home with no agents. The getting-started checklist is already in the corner, collapsed to a pill showing 0 of 8; expanding it shows the first task is creating an agent."
      >
        <AppFrame
          agents={[]}
          showActivity={false}
          overlay={<ChecklistPill done={0} total={TOTAL} />}
        >
          <HomeEmptyScreen />
        </AppFrame>
      </Step>

      <Step
        n={2}
        title="First visit — creating the first agent"
        note="A brand-new user has no agents and no avatars, so there's no avatar to pick. The checklist stays collapsed and doesn't mention avatars yet. Click Create agent here to run the unlock for real in the dock."
      >
        <AppFrame
          id="first-visit-screen"
          agents={[]}
          showActivity={false}
          overlay={<ChecklistPill done={0} total={TOTAL} />}
        >
          <SetupColumn clearDock>
            <AgentSetupView embedded firstTime />
          </SetupColumn>
        </AppFrame>
      </Step>

      <Step
        n={3}
        title="Agent created — avatar unlocks and checklist updates"
        note="Creating the agent opens it and triggers the egg-crack unlock. The avatar is applied to the agent in the sidebar and header. The checklist then reveals a crew row — the unlocked avatar plus eggs for the rest — making it clear each remaining task unlocks another surprise."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatchReplay((k) => k + 1)}
            >
              Replay unlock
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevealReplay((k) => k + 1)}
            >
              Replay reveal
            </Button>
          </div>
        }
      >
        <AppFrame
          agents={[FIRST_AGENT]}
          showActivity={false}
          overlay={
            <>
              <CatchMomentOverlay replayKey={catchReplay} />
              <ChecklistPanel
                key={revealReplay}
                done={1}
                total={TOTAL}
                crew={crew([FIRST_AVATAR]).map((slot, i) =>
                  i === 0 ? { ...slot, justCaught: revealReplay > 0 } : slot,
                )}
                rows={rows(true, FIRST_AVATAR)}
                revealAvatars={revealReplay > 0}
              />
            </>
          }
        >
          <ChatSessionMockup />
        </AppFrame>
      </Step>
    </div>
  );
}
