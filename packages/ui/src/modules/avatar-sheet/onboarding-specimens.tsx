import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CHAR_NAMES, type CharName } from "../agents/components/char-avatar.js";
import {
  AvatarGrid,
  AvatarTile,
  AvatarTrigger,
} from "../agents/components/character-picker.js";
import { MysteryAvatar } from "../agents/components/mystery-avatar.js";
import {
  AVATAR_PIECES,
  pieceBox,
  type PieceKey,
} from "../agents/lib/avatar-pieces.js";
import { CHARACTER_QUESTS } from "../agents/lib/character-unlocks.js";
import {
  CatchBubble,
  CatchCelebration,
  CatchStageFrame,
  CatchStyles,
  type CatchVariant,
  ChecklistPanel,
  ChecklistPill,
  ConfettiBurst,
  CrewSlot,
  type CrewSlotData,
  ProgressRing,
  QuestRow,
  type QuestRowData,
} from "./getting-started-checklist.js";

const TOTAL = CHARACTER_QUESTS.length;

const CONFETTI_LABELS: [CharName, string][] = [
  ["stack", "Bars"],
  ["shield", "D-wings and bar"],
  ["roller", "Half disc and wheels"],
  ["tower", "Posts"],
  ["wave", "Crescents"],
  ["compass", "Teardrops"],
  ["spark", "D-wings and dot"],
  ["lens", "Eyes"],
];

const PIECE_LABELS: [PieceKey, string][] = [
  ["teardrop", "Teardrop"],
  ["dWing", "D-wing"],
  ["halfDisc", "Half disc"],
  ["crescent", "Crescent"],
  ["bar", "Bar"],
  ["shortBar", "Short bar"],
  ["eye", "Eye"],
];

const IN_PROGRESS_REWARDS = new Map<string, CharName>([
  ["first-agent", "shield"],
  ["connect-github", "compass"],
]);
const IN_PROGRESS_CAUGHT: CharName[] = ["shield", "compass"];

function crewFor(caught: readonly CharName[]): CrewSlotData[] {
  return CHAR_NAMES.map((_, i) => ({ name: caught[i] ?? null }));
}

function rowsFor(
  rewards: ReadonlyMap<string, CharName>,
  workingId?: string,
): QuestRowData[] {
  return CHARACTER_QUESTS.map((q) => ({
    ...q,
    reward: rewards.get(q.id) ?? null,
    state: rewards.has(q.id) ? "done" : q.id === workingId ? "working" : "todo",
  }));
}

function Specimen({
  n,
  title,
  note,
  wide,
  children,
}: {
  n: number;
  title: string;
  note: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-background p-5",
        wide && "md:col-span-2",
      )}
    >
      <div>
        <p className="text-sm font-semibold text-foreground">
          {n}. {title}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{note}</p>
      </div>
      <div className="flex flex-wrap items-end gap-6">{children}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function ReplayOnClick({
  label,
  children,
}: {
  label: string;
  children: (key: number) => ReactNode;
}) {
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col items-center gap-2">
      {children(run)}
      <Button variant="outline" size="sm" onClick={() => setRun((r) => r + 1)}>
        {label}
      </Button>
    </div>
  );
}

function LiveCatch() {
  const [run, setRun] = useState<{ n: number; variant: CatchVariant } | null>({
    n: 1,
    variant: "first",
  });
  const replay = (variant: CatchVariant) =>
    setRun((r) => ({ n: (r?.n ?? 0) + 1, variant }));
  return (
    <div className="flex w-full flex-col items-end gap-3">
      <div className="flex h-[190px] w-full items-end justify-end overflow-hidden rounded-lg bg-muted/30 p-4">
        {run && (
          <CatchCelebration
            key={run.n}
            name={run.variant === "first" ? "shield" : "compass"}
            variant={run.variant}
            onFinished={() => setRun(null)}
          />
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => replay("first")}>
          Replay first catch
        </Button>
        <Button variant="outline" size="sm" onClick={() => replay("new")}>
          Replay later catch
        </Button>
      </div>
    </div>
  );
}

export function OnboardingSpecimens() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CatchStyles />

      <Specimen
        n={1}
        title="Checklist panel — new user"
        note="Expanded dock on first visit: nothing caught yet, every slot is a closed pod."
      >
        <ChecklistPanel
          done={0}
          total={TOTAL}
          crew={crewFor([])}
          rows={rowsFor(new Map())}
        />
      </Specimen>

      <Specimen
        n={2}
        title="Checklist panel — in progress"
        note="First agent created and GitHub connected, one task working. Done rows show the avatar they caught."
      >
        <ChecklistPanel
          done={2}
          total={TOTAL}
          crew={crewFor(IN_PROGRESS_CAUGHT)}
          rows={rowsFor(IN_PROGRESS_REWARDS, "add-schedule")}
          disabled
        />
      </Specimen>

      <Specimen
        n={3}
        title="Collapsed pill"
        note="The dock collapsed to progress only. It pulses when a new avatar lands."
        wide
      >
        <Labeled label="0 of 5">
          <ChecklistPill done={0} total={TOTAL} />
        </Labeled>
        <Labeled label="3 of 5">
          <ChecklistPill done={3} total={TOTAL} />
        </Labeled>
        <ReplayOnClick label="Replay pulse">
          {(k) => (
            <ChecklistPill key={k} done={4} total={TOTAL} pulse={k > 0} />
          )}
        </ReplayOnClick>
      </Specimen>

      <Specimen
        n={4}
        title="Progress ring"
        note="One segment per task, so it reads as steps rather than a spinner."
      >
        {Array.from({ length: TOTAL + 1 }, (_, i) => (
          <Labeled key={i} label={`${i}/${TOTAL}`}>
            <ProgressRing done={i} total={TOTAL} />
          </Labeled>
        ))}
      </Specimen>

      <Specimen
        n={5}
        title="Closed pod"
        note="Stands in for every avatar that hasn't been caught, so each one stays a surprise."
      >
        <Labeled label="20px">
          <MysteryAvatar className="size-5" />
        </Labeled>
        <Labeled label="36px">
          <MysteryAvatar className="size-9" />
        </Labeled>
        <Labeled label="56px">
          <MysteryAvatar className="size-14" />
        </Labeled>
      </Specimen>

      <Specimen
        n={6}
        title="Crew slot"
        note="The dock's crew row fills left to right in the order avatars are caught."
      >
        <Labeled label="Empty">
          <CrewSlot name={null} />
        </Labeled>
        <Labeled label="Caught">
          <CrewSlot name="shield" />
        </Labeled>
        <ReplayOnClick label="Replay landing">
          {(k) => <CrewSlot key={k} name="compass" justCaught={k > 0} />}
        </ReplayOnClick>
      </Specimen>

      <Specimen
        n={7}
        title="Task row"
        note="Status, task, a pod for its surprise avatar, and its action."
        wide
      >
        <ul className="w-[340px] rounded-xl border border-border bg-card py-1.5">
          <QuestRow
            title="Connect GitHub"
            cta="Connect"
            reward={null}
            state="todo"
          />
          <QuestRow
            title="Add a skill"
            cta="Add"
            reward={null}
            state="working"
            disabled
          />
          <QuestRow
            title="Schedule a recurring task"
            cta="Schedule"
            reward="wave"
            state="done"
          />
        </ul>
      </Specimen>

      <Specimen
        n={8}
        title="First agent — avatar spot"
        note="A new user has no avatars. The creation screen shows a pod; creating the agent catches one at random and puts it on the agent."
        wide
      >
        <Labeled label="No avatar yet">
          <AvatarTrigger value={null} />
        </Labeled>
        <Labeled label="Catching (after Create)">
          <AvatarTrigger value={null} wobble />
        </Labeled>
        <ReplayOnClick label="Replay reveal">
          {(k) => (
            <AvatarTrigger key={k} value="shield" pop={k > 0} hasNew={false} />
          )}
        </ReplayOnClick>
      </Specimen>

      <Specimen
        n={9}
        title="Catch moment — frames"
        note="Shown above the dock, outside the panel. The pod wobbles, swings open, and the avatar pops out with confetti."
        wide
      >
        <Labeled label="1 · Wobble">
          <CatchStageFrame name="compass" stage="wobble" />
        </Labeled>
        <Labeled label="2 · Opening">
          <CatchStageFrame name="compass" stage="opening" />
        </Labeled>
        <Labeled label="3 · Revealed">
          <CatchStageFrame name="compass" stage="revealed" />
        </Labeled>
      </Specimen>

      <Specimen
        n={10}
        title="Catch moment — live"
        note="The full sequence for the first catch and for later ones. It shrinks toward the dock after a few seconds or on Nice."
        wide
      >
        <LiveCatch />
      </Specimen>

      <Specimen
        n={11}
        title="Catch bubble"
        note="The message next to the avatar: first catch, later catches, and finishing the checklist."
        wide
      >
        <Labeled label="First avatar">
          <CatchBubble variant="first" />
        </Labeled>
        <Labeled label="Later avatars">
          <CatchBubble variant="new" />
        </Labeled>
        <Labeled label="Checklist done">
          <CatchBubble variant="last" />
        </Labeled>
      </Specimen>

      <Specimen
        n={12}
        title="Confetti burst — themes"
        note="Each avatar bursts into its own pieces and colors, so the confetti hints at what just arrived."
        wide
      >
        {CONFETTI_LABELS.map(([name, label]) => (
          <Labeled key={name} label={label}>
            <div className="relative size-32">
              <ConfettiBurst name={name} progress={0.7} />
            </div>
          </Labeled>
        ))}
      </Specimen>

      <Specimen
        n={13}
        title="Confetti pieces"
        note="The shape library, taken straight from the avatars."
        wide
      >
        {PIECE_LABELS.map(([piece, label]) => {
          const box = pieceBox(piece, 32);
          return (
            <Labeled key={piece} label={label}>
              <div className="flex size-12 items-center justify-center">
                <svg
                  viewBox={AVATAR_PIECES[piece].viewBox}
                  width={box.width}
                  height={box.height}
                  aria-hidden
                >
                  <path d={AVATAR_PIECES[piece].d} fill="#697077" />
                </svg>
              </div>
            </Labeled>
          );
        })}
      </Specimen>

      <Specimen
        n={14}
        title="Avatar picker button"
        note="Next to the agent name on the creation screen, once the user has avatars."
      >
        <Labeled label="Default">
          <AvatarTrigger value="shield" />
        </Labeled>
        <Labeled label="New avatar caught">
          <AvatarTrigger value="shield" hasNew />
        </Labeled>
        <Labeled label="Open">
          <AvatarTrigger value="shield" active />
        </Labeled>
      </Specimen>

      <Specimen
        n={15}
        title="Avatar picker tiles"
        note="Caught avatars come first; the rest are locked pods."
      >
        <Labeled label="Available">
          <AvatarTile name="compass" />
        </Labeled>
        <Labeled label="Selected">
          <AvatarTile name="shield" selected />
        </Labeled>
        <Labeled label="Just caught">
          <AvatarTile name="spark" isNew />
        </Labeled>
        <Labeled label="Locked">
          <AvatarTile name={null} />
        </Labeled>
      </Specimen>

      <Specimen
        n={16}
        title="Avatar picker — before first agent"
        note="Opened from the pod on a new user's first agent."
      >
        <div className="rounded-lg border border-border bg-card p-4 shadow-md">
          <AvatarGrid value={null} caught={[]} fresh={new Set()} />
        </div>
      </Specimen>

      <Specimen
        n={17}
        title="Avatar picker — after two catches"
        note="The first avatar is on the agent; the newer one has a dot."
      >
        <div className="rounded-lg border border-border bg-card p-4 shadow-md">
          <AvatarGrid
            value="shield"
            caught={IN_PROGRESS_CAUGHT}
            fresh={new Set<CharName>(["compass"])}
          />
        </div>
      </Specimen>
    </div>
  );
}
