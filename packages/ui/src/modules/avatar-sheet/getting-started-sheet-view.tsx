import React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useStore } from "../../store.js";
import type { CharName } from "../agents/components/char-avatar.js";
import { AgentSetupView } from "../agents/views/agent-setup-view.js";
import {
  AppFrame,
  FirstAgentScreens,
  SetupColumn,
} from "./first-agent-screens.js";
import { GettingStartedControls } from "./getting-started-checklist.js";
import { OnboardingSpecimens } from "./onboarding-specimens.js";

const CHOOSE_AVATAR_POOL: CharName[] = [
  "shield",
  "compass",
  "spark",
  "wave",
  "lens",
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
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

export function GettingStartedSheetView() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <SheetToggle active="getting-started-sheet" />
      <PageHeader
        title="Getting Started"
        description="First-time user experience — onboarding checklist, avatar unlocks, and component specs."
      />

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
    </div>
  );
}
