import { Idea, Power } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import {
  BEE_NAMES,
  BeeAvatar,
  type BeeColors,
} from "../agents/components/bee-avatar.js";
import { BeePongInline } from "./bee-pong-game.js";

type CardState = "running" | "idle" | "hibernated" | "starting";
type SheetTab = "bees" | "carbon";

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
}: {
  name: (typeof BEE_NAMES)[number];
  sleeping: boolean;
  idle?: boolean;
  colors?: BeeColors;
}) {
  return (
    <div className="group flex flex-col items-center gap-2">
      <div
        className={cn(
          CARD_SURFACE,
          "flex size-24 cursor-pointer items-center justify-center transition-colors hover:bg-muted/40",
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
  const beeState = state === "hibernated" ? "hibernated" : "running";
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "group cursor-pointer transition-colors hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <BeeAvatar beeName={beeName} state={beeState} colors={colors} idle={state === "idle"} />
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
          <div className="relative" style={{ width: 400, height: 120 }}>
            <BeePongInline
              className="flex items-center justify-center"
              areaW={400}
              areaH={120}
            />
          </div>
          <h2
            className="mt-3 text-center font-extralight tracking-tighter text-foreground"
            style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", lineHeight: 1 }}
          >
            packaging-layouts
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

const IBM_BEE_COLORS: BeeColors = {
  wings: "#0e6027",
  eyes: "#9f1853",
  body: "#d2a106",
};

const INDIVIDUAL_COLORS: Record<(typeof BEE_NAMES)[number], BeeColors> = {
  signal: { eyes: "#009d9a", body: "#009d9a", wings: "#009d9a" },
  cross: { eyes: "#0072c3", body: "#0072c3", wings: "#0072c3" },
  crown: { eyes: "#0043ce", body: "#0043ce", wings: "#0043ce" },
  shield: { eyes: "#8a3ffc", body: "#8a3ffc", wings: "#8a3ffc" },
  bloom: { eyes: "#24a148", body: "#24a148", wings: "#24a148" },
  tower: { eyes: "#d02670", body: "#d02670", wings: "#d02670" },
  tilt: { eyes: "#0f62fe", body: "#0f62fe", wings: "#0f62fe" },
};

const MULTI_COLORS: Record<(typeof BEE_NAMES)[number], BeeColors> = {
  signal: { eyes: "#0043ce", body: "#009d9a", wings: "#24a148" },
  cross: { eyes: "#8a3ffc", body: "#0072c3", wings: "#d02670" },
  crown: { eyes: "#d02670", body: "#24a148", wings: "#0043ce" },
  shield: { eyes: "#0072c3", body: "#8a3ffc", wings: "#009d9a" },
  bloom: { eyes: "#009d9a", body: "#d02670", wings: "#0f62fe" },
  tower: { eyes: "#24a148", body: "#0043ce", wings: "#0072c3" },
  tilt: { eyes: "#d02670", body: "#009d9a", wings: "#8a3ffc" },
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
        <SectionLabel>Color Pack — Individual</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Each bee gets its own unique Carbon color.
        </p>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              colors={INDIVIDUAL_COLORS[name]}
            />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Color Pack — Multi-color</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          Each bee uses 3 different Carbon colors across its parts.
        </p>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile
              key={name}
              name={name}
              sleeping={false}
              colors={MULTI_COLORS[name]}
            />
          ))}
        </div>
      </section>
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
              active={tab === "carbon"}
              onClick={() => setTab("carbon")}
            >
              Carbon
            </TabPill>
          </div>
        }
      />

      {tab === "bees" ? <BeeSheet /> : <CarbonSheet />}
    </div>
  );
}
