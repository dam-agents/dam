import {
  Add,
  ArrowsVertical,
  ChevronDown,
  Document,
  Folder,
  Idea,
  Image,
  OverflowMenuVertical,
  Power,
  Send,
} from "@carbon/icons-react";
import React, { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { IconRail } from "../../components/icon-rail.js";
import { useStore } from "../../store.js";
import {
  type BeeColors,
  CHAR_COLORS,
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../agents/components/char-avatar.js";
import { unlockAllCharacters } from "../agents/lib/character-unlocks.js";
import { AgentSetupView } from "../agents/views/agent-setup-view.js";
import { SidebarSection } from "../sessions/components/sidebar-section.js";
import { EyeBeeMRebus } from "./eye-bee-m.js";
import { AppFrame, SetupColumn } from "./first-agent-screens.js";

const CHOOSE_AVATAR_POOL: CharName[] = [
  "shield",
  "compass",
  "spark",
  "wave",
  "lens",
];

type CardState = "running" | "idle" | "hibernated" | "starting";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

function cardBadge(state: CardState) {
  switch (state) {
    case "running":
      return <Badge variant="success">Working</Badge>;
    case "idle":
      return <Badge variant="accent">Idle</Badge>;
    case "hibernated":
      return <Badge variant="muted">Hibernating</Badge>;
    case "starting":
      return <Badge variant="warning">Starting</Badge>;
  }
}

function AgentCardShell({
  name,
  subtitle,
  state,
  avatar,
}: {
  name: string;
  subtitle: string;
  state: CardState;
  avatar: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "group cursor-pointer transition-colors hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-4 p-5">
        {avatar}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
            {name}
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center">{cardBadge(state)}</div>
      </div>
    </div>
  );
}

const SAMPLE_TIPS = [
  "Idle agents hibernate to save resources, then wake the instant you or a schedule ping them.",
  "Your workspace survives between runs. Pick up exactly where the agent left off.",
  "Approvals are enforced outside the sandbox, so a compromised agent cannot approve itself.",
  "Set the hibernation timeout to 0 to stop an agent sleeping, for background work with no open session.",
];

const WAKE_SCREENS: { charName: CharName; agentName: string }[] = [
  { charName: "compass", agentName: "design-qa" },
  { charName: "spark", agentName: "user-research" },
  { charName: "lens", agentName: "qa-test-runner" },
];

function CharWakeUpPreview({
  charName,
  agentName,
}: {
  charName: CharName;
  agentName: string;
}) {
  const loopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = loopRef.current;
    if (!el) return;
    const play = () => {
      el.classList.remove("bee-play");
      void el.offsetWidth;
      el.classList.add("bee-play");
    };
    play();
    const iv = setInterval(play, 1600);
    return () => clearInterval(iv);
  }, []);

  return (
    <WakeUpFrame agentName={agentName}>
      <div ref={loopRef} className="flex h-[120px] items-center justify-center">
        <CharAvatar name={charName} state="running" className="size-28" />
      </div>
    </WakeUpFrame>
  );
}

function WakeUpFrame({
  agentName,
  children,
}: {
  agentName: string;
  children: React.ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(
      () => setProgress((p) => (p >= 92 ? 0 : p + Math.random() * 6)),
      900,
    );
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(
      () => setTipIdx((i) => (i + 1) % SAMPLE_TIPS.length),
      5500,
    );
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border-2 border-border">
      <div className="flex h-[480px] w-full flex-col bg-background">
        <div className="relative h-1.5 w-full bg-muted/20">
          <div
            className="absolute inset-y-0 left-0 rounded-r-full bg-primary transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center">
          {children}
          <h2
            className="mt-3 text-center font-extralight tracking-tighter text-foreground"
            style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", lineHeight: 1 }}
          >
            {agentName}
          </h2>

          <div className="mt-6 max-w-sm">
            <p className="min-h-12 text-center text-sm leading-relaxed text-muted-foreground transition-opacity duration-500">
              <Idea
                size={16}
                className="mr-1.5 inline-block align-[-3px] text-muted-foreground/50"
              />
              {SAMPLE_TIPS[tipIdx]}
            </p>
          </div>
        </div>

        <div className="px-8 pb-10 md:px-16">
          <div className="mx-auto flex max-w-2xl justify-center">
            <Button variant="outline">
              <Power size={16} className="mr-1.5" />
              Skip the wait — keep always on
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CharTile({
  name,
  state,
  colors,
  idle,
}: {
  name: CharName;
  state: string;
  colors?: BeeColors;
  idle?: boolean;
}) {
  return (
    <div className="group flex flex-col items-center gap-2">
      <div
        className={cn(
          "rounded-lg border flex size-24 cursor-pointer items-center justify-center transition-colors",
          cn(CARD_SURFACE, "hover:bg-muted/40"),
        )}
      >
        <CharAvatar
          name={name}
          state={state}
          colors={colors}
          idle={idle}
          className="size-16"
        />
      </div>
      <span className="text-sm text-muted-foreground">
        {CHAR_NAMES.indexOf(name) + 1}
      </span>
    </div>
  );
}

const CHAR_CARDS: {
  charName: CharName;
  agentName: string;
  state: CardState;
  subtitle: string;
}[] = [
  {
    charName: "stack",
    agentName: "spec-writer",
    state: "running",
    subtitle: "2 CPU · 2 Gi",
  },
  {
    charName: "shield",
    agentName: "security-review",
    state: "idle",
    subtitle: "1 CPU · 1 Gi",
  },
  {
    charName: "roller",
    agentName: "prototype-builder",
    state: "running",
    subtitle: "2 CPU · 2 Gi",
  },
  {
    charName: "tower",
    agentName: "release-manager",
    state: "hibernated",
    subtitle: "0.5 CPU · 512 Mi",
  },
  {
    charName: "wave",
    agentName: "roadmap-planner",
    state: "running",
    subtitle: "1 CPU · 1 Gi",
  },
  {
    charName: "compass",
    agentName: "design-qa",
    state: "idle",
    subtitle: "2 CPU · 2 Gi",
  },
  {
    charName: "spark",
    agentName: "user-research",
    state: "hibernated",
    subtitle: "0.5 CPU · 512 Mi",
  },
  {
    charName: "lens",
    agentName: "qa-test-runner",
    state: "idle",
    subtitle: "2 CPU · 2 Gi",
  },
];

function SampleCharCard({
  name,
  subtitle,
  state,
  charName,
}: {
  name: string;
  subtitle: string;
  state: CardState;
  charName: CharName;
}) {
  return (
    <AgentCardShell
      name={name}
      subtitle={subtitle}
      state={state}
      avatar={
        <CharAvatar
          name={charName}
          state={state === "hibernated" ? "hibernated" : "running"}
          colors={CHAR_COLORS[charName]}
          idle={state === "idle"}
        />
      }
    />
  );
}

type ChatEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "thinking"; text: string }
  | { role: "tool"; label: string; text: string };

const CHAT_MESSAGES: ChatEntry[] = [
  {
    role: "user",
    text: "Make three hero banner variants for the spring campaign using the new palette.",
  },
  {
    role: "thinking",
    text: "The user wants three hero banner variants. I should pull the spring palette tokens from the design system — sage (#B2C9AD), coral (#FF6B6B), butter (#FFF3B0) — and cross-reference the logo lockup rules in brand-guidelines.pdf before generating.",
  },
  {
    role: "tool",
    label: "read_file",
    text: "brand-guidelines.pdf — extracted logo lockup rules and minimum clear-space requirements.",
  },
  {
    role: "assistant",
    text: "I pulled the spring palette (sage, coral, butter) and the logo lockup rules. Here’s the plan:\n\n1. Bold — full-bleed coral, product centered\n2. Soft — sage gradient, product offset right\n3. Editorial — butter background, large serif headline\n\nGenerating all three at 1920×640.",
  },
  {
    role: "thinking",
    text: "I’ll generate each variant as a separate file. For the editorial variant I should use the serif headline at 72pt with butter background. Need to check if the coral is accessible against white text — contrast ratio should be at least 4.5:1.",
  },
  {
    role: "tool",
    label: "generate_image",
    text: "Created 3 variants → artifacts/hero-spring/bold.png, soft.png, editorial.png",
  },
  {
    role: "assistant",
    text: "All three are in artifacts/hero-spring/. The editorial one is closest to last season’s top performer.",
  },
];

function ChatMessages({
  charName,
  agentName,
}: {
  charName: CharName;
  agentName: string;
}) {
  return (
    <>
      {CHAT_MESSAGES.map((msg, i) => {
        if (msg.role === "thinking") {
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-1.5 pl-8 text-sm italic text-muted-foreground/70">
                <span className="inline-block size-3.5 animate-pulse rounded-full border border-muted-foreground/30" />
                Thinking…
              </div>
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 pl-8 text-sm italic text-muted-foreground">
                {msg.text}
              </div>
            </div>
          );
        }
        if (msg.role === "tool") {
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-1.5 pl-8 text-sm text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
                  {msg.label}
                </span>
              </div>
              <div className="pl-8 text-sm text-muted-foreground">
                {msg.text}
              </div>
            </div>
          );
        }
        return (
          <div
            key={i}
            className={cn(
              "flex flex-col gap-1",
              msg.role === "assistant" ? "items-start" : "items-end",
            )}
          >
            {msg.role === "assistant" && (
              <span className="mb-0.5 flex items-center gap-2">
                <CharAvatar
                  name={charName}
                  state="running"
                  colors={CHAR_COLORS[charName]}
                  className="size-6"
                />
                <span className="text-sm font-semibold text-foreground">
                  {agentName}
                </span>
              </span>
            )}
            {msg.role === "user" && (
              <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                You
              </span>
            )}
            <div
              className={
                msg.role === "assistant"
                  ? "max-w-full whitespace-pre-line pl-8 text-sm text-foreground"
                  : "rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
              }
            >
              {msg.text}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ChatSpecimen() {
  const charName: CharName = "stack";
  const agentName = "spring-campaign";
  const [filesOpen, setFilesOpen] = useState(true);

  return (
    <AppFrame height={760}>
      <div className="flex h-full">
        <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
          <div className="flex h-11 items-center gap-2.5 border-b border-border px-3">
            <CharAvatar
              name={charName}
              state="running"
              colors={CHAR_COLORS[charName]}
              className="size-7"
            />
            <span className="truncate text-sm font-semibold text-foreground">
              {agentName}
            </span>
            <span className="size-2 shrink-0 rounded-full bg-success" />
          </div>
          <SidebarSection
            title="Files"
            open={filesOpen}
            onToggle={() => setFilesOpen((o) => !o)}
            headerClassName="border-t border-border"
            headerRight={
              <Button variant="outline" size="xs" className="text-sm">
                <Add size={12} /> Add
              </Button>
            }
          >
            <div className="overflow-y-auto py-1">
              <div
                className="flex h-8 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 12, paddingRight: 12 }}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <ChevronDown size={16} />
                </span>
                <Folder size={16} />
                <span className="min-w-0 flex-1 truncate">hero-spring</span>
              </div>
              <div
                className="flex h-8 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 26, paddingRight: 12 }}
              >
                <span className="w-4 shrink-0" />
                <Image size={16} />
                <span className="min-w-0 flex-1 truncate">bold.png</span>
              </div>
              <div
                className="flex h-8 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 26, paddingRight: 12 }}
              >
                <span className="w-4 shrink-0" />
                <Image size={16} />
                <span className="min-w-0 flex-1 truncate">editorial.png</span>
              </div>
              <div
                className="flex h-8 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 26, paddingRight: 12 }}
              >
                <span className="w-4 shrink-0" />
                <Image size={16} />
                <span className="min-w-0 flex-1 truncate">soft.png</span>
              </div>
              <div
                className="flex h-8 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 12, paddingRight: 12 }}
              >
                <span className="w-4 shrink-0" />
                <Document size={16} />
                <span className="min-w-0 flex-1 truncate">
                  brand-guidelines.pdf
                </span>
              </div>
            </div>
          </SidebarSection>
          <SidebarSection
            title="Artifacts"
            open
            onToggle={() => {}}
            headerClassName="border-t border-border"
          >
            <div className="flex h-8 w-full items-center gap-1.5 px-3 text-sm text-foreground">
              <ChevronDown size={14} className="text-muted-foreground" />
              <Folder size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">hero-spring</span>
              <span className="shrink-0 text-xs text-muted-foreground">3</span>
            </div>
            <div className="group flex h-8 w-full items-center gap-1.5 py-1 pl-3.5 pr-3 text-sm text-muted-foreground hover:bg-muted">
              <ArrowsVertical
                size={12}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
              />
              <span className="min-w-0 flex-1 truncate">bold.png</span>
            </div>
            <div className="group flex h-8 w-full items-center gap-1.5 py-1 pl-3.5 pr-3 text-sm text-muted-foreground hover:bg-muted">
              <ArrowsVertical
                size={12}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
              />
              <span className="min-w-0 flex-1 truncate">soft.png</span>
            </div>
            <div className="group flex h-8 w-full items-center gap-1.5 py-1 pl-3.5 pr-3 text-sm text-muted-foreground hover:bg-muted">
              <ArrowsVertical
                size={12}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
              />
              <span className="min-w-0 flex-1 truncate">editorial.png</span>
            </div>
          </SidebarSection>
        </div>

        <div className="flex flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-6">
            <span className="flex">
              <CharAvatar
                name={charName}
                state="running"
                colors={CHAR_COLORS[charName]}
                className="size-7"
              />
            </span>
            <h2 className="truncate text-sm font-bold text-foreground">
              {agentName}
            </h2>
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
            <ChatMessages charName={charName} agentName={agentName} />
          </div>
          <div className="px-8 pb-6">
            <div className="mx-auto flex h-12 max-w-3xl items-center justify-between rounded-xl border border-border bg-card px-4 text-sm text-muted-foreground">
              Ask {agentName} to do something
              <Send size={16} />
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function SheetToggle({
  active,
}: {
  active: "avatar-sheet" | "getting-started-sheet";
}) {
  const setView = useStore((s) => s.setView);
  return (
    <div className="mb-6 inline-flex gap-0.5 rounded-full border border-border bg-card p-1">
      <button
        type="button"
        onClick={() => setView("getting-started-sheet")}
        className={cn(
          "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
          active === "getting-started-sheet"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Getting Started
      </button>
      <button
        type="button"
        onClick={() => setView("avatar-sheet")}
        className={cn(
          "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
          active === "avatar-sheet"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Avatar Illustrations
      </button>
    </div>
  );
}

export function AvatarSheetView() {
  useEffect(() => {
    unlockAllCharacters();
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <SheetToggle active="avatar-sheet" />
      <PageHeader
        title="Avatar Design Sheet"
        description="Paul Rand robot avatars — illustrations, placement, and animations."
      />

      <section className="mb-12">
        <SectionLabel>Source — Eye Bee M</SectionLabel>
        <p className="mb-4 max-w-[760px] text-sm text-muted-foreground">
          Paul Rand&apos;s Eye Bee M rebus. Every agent avatar below is built
          from its pieces: the eye&apos;s lid and iris, the bee&apos;s teardrop
          wings, eyes and striped body, and the bars of the M.
        </p>
        <div className="inline-flex overflow-hidden rounded-xl border border-border">
          <EyeBeeMRebus className="block size-[360px]" />
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Character Avatars — Awake</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Less bee-influenced, more abstract — still built from Paul Rand rebus
          pieces. Hover to see gesture animations.
        </p>
        <div className="grid grid-cols-4 gap-4 md:grid-cols-8">
          {CHAR_NAMES.map((n) => (
            <CharTile
              key={n}
              name={n}
              state="running"
              colors={CHAR_COLORS[n]}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Character Avatars — Idle</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Sleeping eyes at rest. Hover to wake — eyes open and parts animate.
        </p>
        <div className="grid grid-cols-4 gap-4 md:grid-cols-8">
          {CHAR_NAMES.map((n) => (
            <CharTile
              key={n}
              name={n}
              state="idle"
              idle
              colors={CHAR_COLORS[n]}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Character Avatars — Hibernating</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          All fills gray, squished posture, occasional twitches. Hover triggers
          breathing.
        </p>
        <div className="grid grid-cols-4 gap-4 md:grid-cols-8">
          {CHAR_NAMES.map((n) => (
            <CharTile
              key={n}
              name={n}
              state="hibernated"
              colors={CHAR_COLORS[n]}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Characters on Agent Cards</SectionLabel>
        <div className="flex flex-col gap-3">
          {CHAR_CARDS.map((c) => (
            <SampleCharCard
              key={c.charName}
              name={c.agentName}
              subtitle={c.subtitle}
              state={c.state}
              charName={c.charName}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Waking from Hibernation</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          When a hibernated agent is opened, it auto-wakes. Its character sits
          in the center and loops its hover animation while the pod spins up.
        </p>
        <div className="flex flex-col gap-6">
          {WAKE_SCREENS.map((w) => (
            <CharWakeUpPreview
              key={w.charName}
              charName={w.charName}
              agentName={w.agentName}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Chat UI — Full Shell</SectionLabel>
        <p className="mb-4 max-w-[760px] text-sm text-muted-foreground">
          Full chat layout with the sidebar, a Files + Artifacts left panel, and
          the conversation center. The agent&apos;s character avatar appears in
          the left-panel header, the chat header, and next to each assistant
          message.
        </p>
        <ChatSpecimen />
      </section>

      <section className="mb-12">
        <SectionLabel>Create Agent — Choose an Avatar</SectionLabel>
        <p className="mb-4 max-w-[760px] text-sm text-muted-foreground">
          Once a user has unlocked avatars, the creation screen shows an avatar
          button next to the name. Click it to pick from the unlocked ones; this
          example has five unlocked and three still in eggs.
        </p>
        <AppFrame height={900}>
          <SetupColumn>
            <AgentSetupView embedded avatarPool={CHOOSE_AVATAR_POOL} />
          </SetupColumn>
        </AppFrame>
      </section>

      <section className="mb-12">
        <SectionLabel>Left Navigation — Agent List</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          The sidebar from design/sidebar-agent-list with each agent&apos;s
          character as its avatar in place of a status dot. Hover a row to
          animate its character.
        </p>
        <div className="h-[760px] w-fit overflow-hidden rounded-xl border-2 border-border">
          <IconRail expanded hideMobileBar />
        </div>
      </section>
    </div>
  );
}
