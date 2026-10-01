import { Idea, Power } from "@carbon/icons-react";
import React, { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { IconRail } from "../../components/icon-rail.js";
import {
  type BeeColors,
  CHAR_COLORS,
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../agents/components/char-avatar.js";
import { AgentSetupView } from "../agents/views/agent-setup-view.js";
import { EyeBeeMRebus } from "./eye-bee-m.js";
import {
  AppFrame,
  FirstAgentScreens,
  SetupColumn,
} from "./first-agent-screens.js";
import { GettingStartedControls } from "./getting-started-checklist.js";
import { OnboardingSpecimens } from "./onboarding-specimens.js";

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

const CHOOSE_AVATAR_POOL: CharName[] = [
  "shield",
  "compass",
  "spark",
  "wave",
  "lens",
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

function PaulRandSheet() {
  return (
    <>
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

      <section id="create-agent-preview" className="mb-12 scroll-mt-6">
        <SectionLabel>Create Agent — Choose a Character</SectionLabel>
        <p className="mb-6 max-w-[760px] text-sm text-muted-foreground">
          A first-time user creating their first agent, step by step. Avatars
          stay hidden until the first one is unlocked, then the checklist shows
          there are more to unlock.
        </p>
        <FirstAgentScreens />
      </section>

      <section className="mb-12">
        <SectionLabel>Getting Started — Unlock New Avatars</SectionLabel>
        <p className="mb-4 max-w-[760px] text-sm text-muted-foreground">
          The checklist is docked in the lower right of this page and stays
          there until all eight tasks are done, one per avatar. Collapse it to a
          pill that shows progress. Tasks are finished elsewhere in the app;
          hover the i on a task to see how. New users start with no avatars.
          Clicking Create agent on the first screen above unlocks their first
          one at random and puts it on that agent. Every other task unlocks
          another random avatar, and the ones not unlocked yet stay eggs, so
          each one is a surprise. When a task is finished, even with the
          checklist collapsed, the egg cracks open above the dock and the new
          avatar joins the crew.
        </p>
        <GettingStartedControls />
      </section>

      <section className="mb-12">
        <SectionLabel>Onboarding Components</SectionLabel>
        <p className="mb-4 max-w-[760px] text-sm text-muted-foreground">
          Every piece of the getting-started flow on its own, in each of its
          states. These are separate from the live dock, so nothing here changes
          your progress.
        </p>
        <OnboardingSpecimens />
      </section>
    </>
  );
}

export function AvatarSheetView() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <PageHeader
        title="Avatar Design Sheet"
        description="Paul Rand robot avatars — design specs and component reference."
      />
      <PaulRandSheet />
    </div>
  );
}
