import {
  ArrowRight,
  CheckmarkFilled,
  ChevronDown,
  ChevronUp,
  Information,
} from "@carbon/icons-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useStore } from "../../store.js";
import { CatchStyles } from "../agents/components/catch-styles.js";
import {
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../agents/components/char-avatar.js";
import {
  EggShape,
  MysteryAvatar,
} from "../agents/components/mystery-avatar.js";
import {
  AVATAR_PIECES,
  CONFETTI_THEMES,
  pieceBox,
} from "../agents/lib/avatar-pieces.js";
import {
  CHARACTER_QUESTS,
  completeQuest,
  endCelebration,
  FIRST_AGENT_QUEST_ID,
  type QuestAction,
  resetCharacterUnlocks,
  useCharacterUnlocks,
} from "../agents/lib/character-unlocks.js";

const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  angle: i * (360 / 14) + (i % 2 ? 9 : -6),
  distance: 58 + ((i * 7) % 22),
  spin: (i * 53) % 360,
}));

export type CatchStage = "wobble" | "opening" | "revealed";

export interface CrewSlotData {
  name: CharName | null;
  justCaught?: boolean;
}

export type CatchVariant = "first" | "new" | "last";

export type QuestRowState = "todo" | "working" | "done";

export interface QuestRowData {
  id: string;
  title: string;
  help: string;
  action: QuestAction;
  reward: CharName | null;
  state: QuestRowState;
}

export function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 10;
  const step = 360 / total;
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${14 + r * Math.cos(rad)} ${14 + r * Math.sin(rad)}`;
  };
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const start = -90 + i * step + 9;
        const end = start + step - 18;
        return (
          <path
            key={i}
            d={`M ${point(start)} A ${r} ${r} 0 0 1 ${point(end)}`}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn(
              "transition-colors duration-500",
              i < done ? "stroke-primary" : "stroke-[#c1c7cd]",
            )}
          />
        );
      })}
    </svg>
  );
}

export function CrewSlot({ name, justCaught }: CrewSlotData) {
  const caught = name !== null;
  return (
    <div
      className={cn(
        "flex size-8 items-center justify-center rounded-md border",
        caught
          ? "group border-border bg-card"
          : "border-dashed border-border bg-muted/30",
      )}
    >
      {name ? (
        <div
          className={cn(
            "flex",
            justCaught &&
              "animate-[catch-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        >
          <CharAvatar name={name} state="running" className="size-6" />
        </div>
      ) : (
        <MysteryAvatar className="size-5" />
      )}
    </div>
  );
}

function useQuestAction(action: QuestAction) {
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return () => {
    if (action.settingsTab) {
      navigateToSettings(action.settingsTab);
    } else if (action.sandbox) {
      selectAgent("a1b2c3d4-0001-4000-8000-000000000001");
      navigateToSandboxHome(
        "a1b2c3d4-0001-4000-8000-000000000001",
        action.sandbox,
      );
    } else if (action.prefill) {
      selectAgent("a1b2c3d4-0001-4000-8000-000000000001");
    } else if (action.view) {
      setView(action.view);
    }
  };
}

export function QuestRow({
  title,
  help,
  action,
  reward,
  state,
  showReward = true,
}: Omit<QuestRowData, "id"> & { showReward?: boolean }) {
  const done = state === "done";
  const handleAction = useQuestAction(action);
  return (
    <li className="flex list-none items-center gap-3 px-4 py-1.5">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {done ? (
          <CheckmarkFilled size={16} className="text-success" />
        ) : state === "working" ? (
          <Spinner size={16} />
        ) : (
          <span className="size-4 rounded-full border-2 border-border" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            "truncate text-sm",
            done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`How to ${title.toLowerCase()}`}
              className="flex shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <Information size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" className="w-[220px] p-3">
            <p className="text-sm text-muted-foreground">{help}</p>
            <button
              type="button"
              onClick={handleAction}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              {action.label}
              <ArrowRight size={16} />
            </button>
          </PopoverContent>
        </Popover>
      </span>
      {showReward && (
        <span className="flex size-6 shrink-0 items-center justify-center">
          {done && reward ? (
            <span className="group flex">
              <CharAvatar name={reward} state="running" className="size-6" />
            </span>
          ) : (
            <MysteryAvatar className="size-5" />
          )}
        </span>
      )}
    </li>
  );
}

export function ChecklistPanel({
  done,
  total,
  crew,
  rows,
  showAvatars = true,
  revealAvatars,
  onCollapse,
}: {
  done: number;
  total: number;
  crew: CrewSlotData[];
  rows: QuestRowData[];
  showAvatars?: boolean;
  revealAvatars?: boolean;
  onCollapse?: () => void;
}) {
  return (
    <div className="w-[340px] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
      <div
        className={cn(
          "flex items-center gap-3 px-4 pt-3.5",
          showAvatars ? "pb-3" : "pb-3.5",
        )}
      >
        <ProgressRing done={done} total={total} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <p className="text-sm text-muted-foreground">
            {done} of {total} done
            {showAvatars && " · unlock new avatars"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse checklist"
          onClick={onCollapse}
        >
          <ChevronDown size={16} />
        </Button>
      </div>

      {showAvatars && (
        <div
          className={cn(
            "flex gap-1.5 px-4 pb-3",
            revealAvatars &&
              "animate-[dock-reveal_0.45s_cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        >
          {crew.map((slot, i) => (
            <CrewSlot key={slot.name ?? `empty-${i}`} {...slot} />
          ))}
        </div>
      )}

      <ul className="border-t border-border py-1.5">
        {rows.map((row) => (
          <QuestRow key={row.id} {...row} showReward={showAvatars} />
        ))}
      </ul>
    </div>
  );
}

export function ChecklistPill({
  done,
  total,
  pulse,
  onExpand,
}: {
  done: number;
  total: number;
  pulse?: boolean;
  onExpand?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Get started, ${done} of ${total} done. Expand checklist`}
      className={cn(
        "flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card pl-2 pr-4 shadow-lg transition-colors hover:bg-muted/40",
        pulse && "animate-[dock-pulse_0.7s_ease-out]",
      )}
    >
      <ProgressRing done={done} total={total} />
      <span className="text-sm font-semibold text-foreground">Get started</span>
      <span className="text-sm text-muted-foreground">
        {done}/{total}
      </span>
      <ChevronUp size={16} className="text-muted-foreground" />
    </button>
  );
}

export function ConfettiBurst({
  name,
  progress,
}: {
  name: CharName;
  progress?: number;
}) {
  const theme = CONFETTI_THEMES[name];
  return (
    <>
      {CONFETTI.map((p, i) => {
        const bit = theme[i % theme.length]!;
        const box = pieceBox(bit.piece, bit.size);
        const shape = AVATAR_PIECES[bit.piece];
        const frozen =
          progress === undefined
            ? undefined
            : {
                transform: `translateY(${-p.distance * progress}px) rotate(${110 * progress}deg)`,
                opacity: 1 - progress * 0.5,
              };
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `rotate(${p.angle}deg)` }}
          >
            <span
              className={cn(
                "block",
                !frozen &&
                  "opacity-0 animate-[catch-confetti_0.85s_cubic-bezier(0.2,0.8,0.3,1)_0.95s_forwards]",
              )}
              style={
                {
                  "--d": `${p.distance}px`,
                  marginLeft: -box.width / 2,
                  marginTop: -box.height / 2,
                  ...frozen,
                } as unknown as CSSProperties
              }
            >
              <svg
                viewBox={shape.viewBox}
                width={box.width}
                height={box.height}
                aria-hidden
                className="block"
                style={{ transform: `rotate(${p.spin}deg)` }}
              >
                <path d={shape.d} fill={bit.color} />
              </svg>
            </span>
          </span>
        );
      })}
    </>
  );
}

function EggHalves({
  animate,
  topStyle,
  bottomStyle,
}: {
  animate?: boolean;
  topStyle?: CSSProperties;
  bottomStyle?: CSSProperties;
}) {
  return (
    <>
      <EggShape
        part="bottom"
        style={bottomStyle}
        className={cn(
          "absolute inset-0 size-full",
          animate && "animate-[catch-open-bottom_0.45s_ease-out_0.9s_forwards]",
        )}
      />
      <EggShape
        part="top"
        style={topStyle}
        className={cn(
          "absolute inset-0 size-full origin-bottom",
          animate && "animate-[catch-open-top_0.5s_ease-out_0.9s_forwards]",
        )}
      />
    </>
  );
}

export function CatchStageFrame({
  name,
  stage,
}: {
  name: CharName;
  stage: CatchStage;
}) {
  return (
    <div className="relative size-32 shrink-0">
      {stage !== "wobble" && (
        <ConfettiBurst
          name={name}
          progress={stage === "opening" ? 0.35 : 0.8}
        />
      )}
      {stage !== "revealed" && (
        <div
          className="absolute inset-9"
          style={{ transform: stage === "wobble" ? "rotate(-14deg)" : "none" }}
        >
          <EggHalves
            topStyle={
              stage === "opening"
                ? { transform: "translate(-5px, -16px) rotate(-22deg)" }
                : undefined
            }
            bottomStyle={
              stage === "opening"
                ? { transform: "translate(0, 5px)", opacity: 0.85 }
                : undefined
            }
          />
        </div>
      )}
      {stage !== "wobble" && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={
            stage === "opening"
              ? { transform: "scale(0.55)", opacity: 0.8 }
              : undefined
          }
        >
          <CharAvatar name={name} state="running" className="size-24" />
        </div>
      )}
    </div>
  );
}

const BUBBLE_COPY: Record<CatchVariant, { title: string; body: string }> = {
  first: {
    title: "You unlocked your first agent avatar!",
    body: "It's now your new agent's avatar. Finish the checklist to unlock more.",
  },
  new: {
    title: "You unlocked a new agent avatar!",
    body: "It's ready to pick the next time you create an agent.",
  },
  last: {
    title: "You unlocked every agent avatar!",
    body: "Your crew is complete. Pick any of them when you create an agent.",
  },
};

export function CatchBubble({
  variant = "new",
  animated,
  onDismiss,
}: {
  variant?: CatchVariant;
  animated?: boolean;
  onDismiss?: () => void;
}) {
  const copy = BUBBLE_COPY[variant];
  return (
    <div
      className={cn(
        "relative mb-8 w-[250px] rounded-2xl border border-border bg-card p-4 shadow-xl",
        animated &&
          "opacity-0 animate-[catch-bubble_0.35s_ease-out_1.15s_forwards]",
      )}
    >
      <p className="text-sm font-semibold text-foreground">{copy.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{copy.body}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onDismiss}>
          Nice
        </Button>
      </div>
      <span className="absolute -right-[7px] bottom-9 size-3.5 rotate-45 border-r border-t border-border bg-card" />
    </div>
  );
}

export function CatchCelebration({
  name,
  variant = "new",
  onFinished,
}: {
  name: CharName;
  variant?: CatchVariant;
  onFinished?: () => void;
}) {
  const [collecting, setCollecting] = useState(false);
  const loopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = loopRef.current;
    const play = () => {
      if (!el) return;
      el.classList.remove("bee-play");
      void el.offsetWidth;
      el.classList.add("bee-play");
    };
    const first = setTimeout(play, 1350);
    const loop = setInterval(play, 1700);
    const auto = setTimeout(() => setCollecting(true), 6500);
    return () => {
      clearTimeout(first);
      clearInterval(loop);
      clearTimeout(auto);
    };
  }, []);

  useEffect(() => {
    if (!collecting) return;
    const t = setTimeout(() => onFinished?.(), 450);
    return () => clearTimeout(t);
  }, [collecting, onFinished]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex origin-bottom-right items-end gap-1",
        collecting && "animate-[catch-collect_0.45s_ease-in_forwards]",
      )}
    >
      <CatchBubble
        variant={variant}
        animated
        onDismiss={() => setCollecting(true)}
      />
      <div className="relative size-32 shrink-0">
        <ConfettiBurst name={name} />
        <div className="absolute inset-9 animate-[catch-wobble_0.9s_ease-in-out]">
          <EggHalves animate />
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 animate-[catch-pop_0.6s_cubic-bezier(0.34,1.56,0.64,1)_0.95s_forwards]">
          <div ref={loopRef}>
            <CharAvatar name={name} state="running" className="size-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GettingStartedDock() {
  const { caught, rewards, working, celebrating, collected } =
    useCharacterUnlocks();
  const [expanded, setExpanded] = useState(true);

  const inFlight = celebrating?.name ?? null;
  const settledQuest = (id: string) =>
    rewards.has(id) && celebrating?.questId !== id;
  const total = CHARACTER_QUESTS.length;
  const done = CHARACTER_QUESTS.filter((q) => settledQuest(q.id)).length;
  const variant: CatchVariant =
    celebrating?.questId === FIRST_AGENT_QUEST_ID
      ? "first"
      : rewards.size === total
        ? "last"
        : "new";

  if (done === total && !celebrating) return null;

  const rows: QuestRowData[] = CHARACTER_QUESTS.map((q) => ({
    ...q,
    reward: rewards.get(q.id) ?? null,
    state: settledQuest(q.id) ? "done" : working === q.id ? "working" : "todo",
  }));
  const settledCaught = caught.filter((n) => n !== inFlight);
  const crew: CrewSlotData[] = CHAR_NAMES.map((_, i) => ({
    name: settledCaught[i] ?? null,
    justCaught:
      settledCaught[i] !== undefined && settledCaught[i] === collected,
  }));

  return (
    <div className="fixed bottom-4 right-[4.5rem] z-[60] flex flex-col items-end gap-3">
      <CatchStyles />
      {celebrating && (
        <CatchCelebration
          key={celebrating.name}
          name={celebrating.name}
          variant={variant}
          onFinished={endCelebration}
        />
      )}

      {expanded ? (
        <ChecklistPanel
          done={done}
          total={total}
          crew={crew}
          rows={rows}
          showAvatars={done > 0}
          revealAvatars={done === 1 && collected !== null}
          onCollapse={() => setExpanded(false)}
        />
      ) : (
        <ChecklistPill
          key={collected ?? "none"}
          done={done}
          total={total}
          pulse={collected !== null}
          onExpand={() => setExpanded(true)}
        />
      )}
    </div>
  );
}

export function GettingStartedControls() {
  const { rewards, working, celebrating } = useCharacterUnlocks();
  const busy = working !== null || celebrating !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        Pretend the user finished:
      </span>
      {CHARACTER_QUESTS.map((q) => (
        <Button
          key={q.id}
          variant="outline"
          size="sm"
          disabled={busy || rewards.has(q.id)}
          onClick={() => completeQuest(q.id)}
        >
          {q.title}
        </Button>
      ))}
      <Button variant="ghost" size="sm" onClick={resetCharacterUnlocks}>
        Reset
      </Button>
    </div>
  );
}

export { CatchStyles };
