import { Idea, Power } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { BEE_NAMES, BeeAvatar } from "../agents/components/bee-avatar.js";

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
}: {
  name: (typeof BEE_NAMES)[number];
  sleeping: boolean;
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
          className="size-16"
        />
      </div>
      <span className="text-sm text-muted-foreground">{name}</span>
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
}: {
  name: string;
  subtitle: string;
  state: CardState;
  beeName: (typeof BEE_NAMES)[number];
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
        <BeeAvatar beeName={beeName} state={beeState} />
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
          <BeeAvatar beeName="shield" state="running" className="size-14 mb-5" />
          <h2
            className="text-center font-extralight tracking-tighter text-foreground"
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

function BeeSheet() {
  const [sleeping, setSleeping] = useState(false);

  return (
    <>
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <SectionLabel>All Bees</SectionLabel>
          <TabPill active={sleeping} onClick={() => setSleeping((v) => !v)}>
            {sleeping ? "Sleeping" : "Awake"}
          </TabPill>
        </div>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-7">
          {BEE_NAMES.map((name) => (
            <BeeTile key={name} name={name} sleeping={sleeping} />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Bees on Agent Cards</SectionLabel>
        <div className="flex flex-col gap-3">
          <SampleAgentCard
            name="brand-asset-generator"
            subtitle="2 CPU · 2 Gi"
            state="running"
            beeName="signal"
          />
          <SampleAgentCard
            name="photo-retouching"
            subtitle="1 CPU · 1 Gi"
            state="idle"
            beeName="cross"
          />
          <SampleAgentCard
            name="brand-guidelines"
            subtitle="0.25 CPU · 512 Mi"
            state="running"
            beeName="crown"
          />
          <SampleAgentCard
            name="packaging-layouts"
            subtitle="2 CPU · 2 Gi"
            state="hibernated"
            beeName="shield"
          />
          <SampleAgentCard
            name="competitor-mood-boards"
            subtitle="0.25 CPU · 512 Mi"
            state="hibernated"
            beeName="bloom"
          />
          <SampleAgentCard
            name="color-palette-testing"
            subtitle="1 CPU · 1 Gi"
            state="idle"
            beeName="tower"
          />
          <SampleAgentCard
            name="hero-image-variants"
            subtitle="0.5 CPU · 1 Gi"
            state="running"
            beeName="tilt"
          />
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Waking from Hibernation</SectionLabel>
        <p className="mb-4 text-sm text-muted-foreground">
          When a hibernated agent is opened, it auto-wakes. This full-page
          overlay keeps the user waiting while the pod spins up, with rotating
          tips and a prompt to keep the agent always on.
        </p>
        <WakeUpPreview />
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
