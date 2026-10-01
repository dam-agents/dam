import { Idea, Power } from "@carbon/icons-react";
import React, { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { IconRail } from "../../components/icon-rail.js";
import {
  BEE_NAMES,
  BeeAvatar,
  type BeeColors,
} from "../agents/components/bee-avatar.js";
import {
  CHAR_COLORS,
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../agents/components/char-avatar.js";
import { AgentSetupView } from "../agents/views/agent-setup-view.js";
import { BeePongInline } from "./bee-pong-game.js";
import { EyeBeeMRebus } from "./eye-bee-m.js";
import {
  AppFrame,
  FirstAgentScreens,
  SetupColumn,
} from "./first-agent-screens.js";
import {
  GettingStartedControls,
  GettingStartedDock,
} from "./getting-started-checklist.js";
import { OnboardingSpecimens } from "./onboarding-specimens.js";

type CardState = "running" | "idle" | "hibernated" | "starting";
type SheetTab = "bees" | "carbon" | "paul-rand";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

function BeeTile({
  name,
  sleeping,
  idle,
  colors,
  dark,
}: {
  name: (typeof BEE_NAMES)[number];
  sleeping: boolean;
  idle?: boolean;
  colors?: BeeColors;
  dark?: boolean;
}) {
  return (
    <div className="group flex flex-col items-center gap-2">
      <div
        className={cn(
          "rounded-lg border flex size-24 cursor-pointer items-center justify-center transition-colors",
          dark
            ? "bg-black hover:bg-zinc-900 border-zinc-800"
            : cn(CARD_SURFACE, "hover:bg-muted/40"),
        )}
      >
        <BeeAvatar
          beeName={name}
          state={sleeping ? "hibernated" : "running"}
          colors={colors}
          idle={idle}
          className="size-16"
        />
      </div>
      <span className="text-sm text-muted-foreground">
        {BEE_NAMES.indexOf(name) + 1}
      </span>
    </div>
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

function SampleAgentCard({
  name,
  subtitle,
  state,
  beeName,
  colors,
}: {
  name: string;
  subtitle: string;
  state: CardState;
  beeName: (typeof BEE_NAMES)[number];
  colors?: BeeColors;
}) {
  return (
    <AgentCardShell
      name={name}
      subtitle={subtitle}
      state={state}
      avatar={
        <BeeAvatar
          beeName={beeName}
          state={state === "hibernated" ? "hibernated" : "running"}
          colors={colors}
          idle={state === "idle"}
        />
      }
    />
  );
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

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const SAMPLE_TIPS = [
  "Idle agents hibernate to save resources, then wake the instant you or a schedule ping them.",
  "Your workspace survives between runs. Pick up exactly where the agent left off.",
  "Approvals are enforced outside the sandbox, so a compromised agent cannot approve itself.",
  "Set the hibernation timeout to 0 to stop an agent sleeping, for background work with no open session.",
];

function WakeUpPreview() {
  return (
    <WakeUpFrame agentName="packaging-layouts">
      <div className="relative" style={{ width: 400, height: 120 }}>
        <BeePongInline
          className="flex items-center justify-center"
          areaW={400}
          areaH={120}
        />
      </div>
    </WakeUpFrame>
  );
}

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

const IBM_BEE_COLORS: BeeColors = {
  wings: "#0e6027",
  eyes: "#9f1853",
  body: "#d2a106",
};

function BeeSheet() {
  return (
    <>
      <section className="mb-12">
        <SectionLabel>All Agents — Awake</SectionLabel>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              colors={IBM_BEE_COLORS}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>All Agents — Idle</SectionLabel>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              idle
              colors={IBM_BEE_COLORS}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>All Agents — Sleeping</SectionLabel>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile key={name} name={name} sleeping={true} />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Bees on Agent Cards</SectionLabel>
        <div className="flex flex-col gap-3">
          <SampleAgentCard
            name="api-gateway"
            subtitle="2 CPU · 2 Gi"
            state="running"
            beeName="signal"
            colors={IBM_BEE_COLORS}
          />
          <SampleAgentCard
            name="test-runner"
            subtitle="1 CPU · 1 Gi"
            state="idle"
            beeName="cross"
            colors={IBM_BEE_COLORS}
          />
          <SampleAgentCard
            name="ci-pipeline"
            subtitle="0.25 CPU · 512 Mi"
            state="running"
            beeName="crown"
            colors={IBM_BEE_COLORS}
          />
          <SampleAgentCard
            name="code-review"
            subtitle="2 CPU · 2 Gi"
            state="hibernated"
            beeName="shield"
            colors={IBM_BEE_COLORS}
          />
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Waking from Hibernation</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          When a hibernated agent is opened, it auto-wakes. The bee icon breaks
          apart into a mini pong game while the pod spins up — wings become
          paddles, eyes become the ball, body bars form the net.
        </p>
        <WakeUpPreview />
      </section>

      <section className="mb-12">
        <SectionLabel>Color Pack — IBM Bee</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Green wings, pink eyes, yellow bodies — inspired by the IBM bee.
        </p>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              colors={IBM_BEE_COLORS}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Color Pack — IBM Bee (copy)</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Duplicate of classic IBM bee for iteration.
        </p>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              colors={
                name === "crown"
                  ? { wings: "#0e6027", eyes: "#9f1853", body: "#eb6200" }
                  : name === "bloom" || name === "tilt"
                    ? { wings: "#0e6027", eyes: "#9f1853", body: "#eb6200" }
                    : name === "cross" || name === "shield"
                      ? { wings: "#0072c3", eyes: "#9f1853", body: "#d2a106" }
                      : IBM_BEE_COLORS
              }
            />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-5">
          {[
            { hex: "#0e6027", name: "Green 60 (wings)" },
            { hex: "#0072c3", name: "Cyan 60 (wings)" },
            { hex: "#9f1853", name: "Magenta 60 (eyes)" },
            { hex: "#d2a106", name: "Yellow 40 (body)" },
            { hex: "#eb6200", name: "Orange 50 (body)" },
          ].map((s) => (
            <div key={s.hex} className="flex flex-col items-center gap-1.5">
              <div
                className="size-8 rounded-full"
                style={{ backgroundColor: s.hex }}
                title={s.name}
              />
              <span className="text-[11px] leading-tight text-muted-foreground">
                {s.name}
              </span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground/60">
                {s.hex}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Agent Cards — New Color Set</SectionLabel>
        <div className="flex flex-col gap-3">
          <SampleAgentCard
            name="signal-agent"
            subtitle="2 CPU · 2 Gi"
            state="running"
            beeName="signal"
            colors={IBM_BEE_COLORS}
          />
          <SampleAgentCard
            name="cross-agent"
            subtitle="1 CPU · 1 Gi"
            state="idle"
            beeName="cross"
            colors={{ wings: "#0072c3", eyes: "#9f1853", body: "#d2a106" }}
          />
          <SampleAgentCard
            name="crown-agent"
            subtitle="2 CPU · 2 Gi"
            state="running"
            beeName="crown"
            colors={{ wings: "#0e6027", eyes: "#9f1853", body: "#eb6200" }}
          />
          <SampleAgentCard
            name="shield-agent"
            subtitle="0.25 CPU · 512 Mi"
            state="hibernated"
            beeName="shield"
            colors={{ wings: "#0072c3", eyes: "#9f1853", body: "#d2a106" }}
          />
          <SampleAgentCard
            name="bloom-agent"
            subtitle="1 CPU · 1 Gi"
            state="running"
            beeName="bloom"
            colors={{ wings: "#0e6027", eyes: "#9f1853", body: "#eb6200" }}
          />
          <SampleAgentCard
            name="tower-agent"
            subtitle="2 CPU · 2 Gi"
            state="idle"
            beeName="tower"
            colors={IBM_BEE_COLORS}
          />
          <SampleAgentCard
            name="tilt-agent"
            subtitle="0.25 CPU · 512 Mi"
            state="hibernated"
            beeName="tilt"
            colors={{ wings: "#0e6027", eyes: "#9f1853", body: "#eb6200" }}
          />
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Carbon Color Options</SectionLabel>
        <p className="mb-6 text-sm text-muted-foreground">
          Harmonious Carbon neighbors for each bee part.
        </p>
        <div className="flex flex-col gap-8">
          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Wings</p>
            <div className="flex flex-wrap gap-5">
              {[
                { hex: "#0e6027", name: "Green 60" },
                { hex: "#198038", name: "Green 50" },
                { hex: "#044317", name: "Green 70" },
                { hex: "#005d5d", name: "Teal 60" },
                { hex: "#007d79", name: "Teal 50" },
                { hex: "#005149", name: "Teal 70" },
                { hex: "#1192e8", name: "Cyan 50" },
                { hex: "#0072c3", name: "Cyan 60" },
                { hex: "#00539a", name: "Cyan 70" },
                { hex: "#003a6d", name: "Cyan 80" },
                { hex: "#33b1ff", name: "Cyan 40" },
              ].map((s) => (
                <div key={s.hex} className="flex flex-col items-center gap-1.5">
                  <div
                    className="size-8 rounded-full"
                    style={{ backgroundColor: s.hex }}
                    title={s.name}
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground/60">
                    {s.hex}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Eyes</p>
            <div className="flex flex-wrap gap-5">
              {[
                { hex: "#9f1853", name: "Magenta 60" },
                { hex: "#d02670", name: "Magenta 50" },
                { hex: "#ff7eb6", name: "Magenta 40" },
                { hex: "#740937", name: "Magenta 70" },
                { hex: "#da1e28", name: "Red 50" },
                { hex: "#a2191f", name: "Red 60" },
                { hex: "#8a3ffc", name: "Purple 50" },
              ].map((s) => (
                <div key={s.hex} className="flex flex-col items-center gap-1.5">
                  <div
                    className="size-8 rounded-full"
                    style={{ backgroundColor: s.hex }}
                    title={s.name}
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground/60">
                    {s.hex}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Body</p>
            <div className="flex flex-wrap gap-5">
              {[
                { hex: "#d2a106", name: "Yellow 40" },
                { hex: "#f1c21b", name: "Yellow 30" },
                { hex: "#b28600", name: "Yellow 50" },
                { hex: "#8e6a00", name: "Yellow 60" },
                { hex: "#eb6200", name: "Orange 50" },
                { hex: "#ba4e00", name: "Orange 60" },
                { hex: "#8a3800", name: "Orange 70" },
              ].map((s) => (
                <div key={s.hex} className="flex flex-col items-center gap-1.5">
                  <div
                    className="size-8 rounded-full"
                    style={{ backgroundColor: s.hex }}
                    title={s.name}
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground/60">
                    {s.hex}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
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
      <GettingStartedDock />
    </>
  );
}

function CarbonSheet() {
  return (
    <iframe
      src="/agent-avatar-design-sheet.html"
      className="h-[calc(100vh-140px)] w-full rounded-lg border border-border"
      title="Carbon Avatar Design Sheet"
    />
  );
}

export function AvatarSheetView() {
  const [tab, setTab] = useState<SheetTab>("bees");

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <PageHeader
        title="Avatar Design Sheet"
        description="Bee icons and Carbon robot avatars for agent cards."
        actions={
          <div className="flex items-center gap-2">
            <TabPill active={tab === "bees"} onClick={() => setTab("bees")}>
              Bees
            </TabPill>
            <TabPill
              active={tab === "paul-rand"}
              onClick={() => setTab("paul-rand")}
            >
              Paul Rand
            </TabPill>
            <TabPill active={tab === "carbon"} onClick={() => setTab("carbon")}>
              Carbon
            </TabPill>
          </div>
        }
      />

      {tab === "bees" ? (
        <BeeSheet />
      ) : tab === "paul-rand" ? (
        <PaulRandSheet />
      ) : (
        <CarbonSheet />
      )}
    </div>
  );
}
