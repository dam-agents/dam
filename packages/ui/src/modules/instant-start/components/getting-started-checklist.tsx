import { useCallback, useEffect, useRef, useState } from "react";

import { CatchStyles } from "../../agents/components/catch-styles.js";
import {
  CHAR_NAMES,
  type CharName,
} from "../../agents/components/char-avatar.js";
import {
  CHARACTER_QUESTS,
  completeQuest,
  endCelebration,
  FIRST_AGENT_QUEST_ID,
  resetCharacterUnlocks,
  useCharacterUnlocks,
} from "../../agents/lib/character-unlocks.js";
import {
  CatchCelebration,
  type CatchVariant,
  ChecklistPanel,
  type CrewSlotData,
  ProgressRing,
  type QuestRowData,
} from "../../avatar-sheet/getting-started-checklist.js";

export { ProgressRing };

let checklistInitialized = false;

export function useChecklistState(autoInit = false) {
  const { caught, rewards, working, celebrating, collected } =
    useCharacterUnlocks();

  useEffect(() => {
    if (!autoInit) return;
    if (checklistInitialized) return;
    checklistInitialized = true;
    resetCharacterUnlocks();
    const t = setTimeout(() => completeQuest(FIRST_AGENT_QUEST_ID), 50);
    return () => {
      clearTimeout(t);
      checklistInitialized = false;
    };
  }, [autoInit]);

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

  const finished = done === total && !celebrating;

  const rows: QuestRowData[] = CHARACTER_QUESTS.map((q) => ({
    ...q,
    reward: rewards.get(q.id) ?? null,
    state: settledQuest(q.id) ? "done" : working === q.id ? "working" : "todo",
  }));
  const settledCaught = caught.filter((n: CharName) => n !== inFlight);
  const crew: CrewSlotData[] = CHAR_NAMES.map((_: CharName, i: number) => ({
    name: settledCaught[i] ?? null,
    justCaught:
      settledCaught[i] !== undefined && settledCaught[i] === collected,
  }));

  return {
    done,
    total,
    rows,
    crew,
    variant,
    celebrating,
    collected,
    finished,
  };
}

export function ChecklistCelebration({
  onDismiss,
}: {
  onDismiss?: () => void;
}) {
  const { celebrating, variant } = useChecklistState();
  if (!celebrating) return null;
  return (
    <>
      <CatchStyles />
      <CatchCelebration
        key={celebrating.name}
        name={celebrating.name}
        variant={variant}
        onFinished={() => {
          endCelebration();
          onDismiss?.();
        }}
      />
    </>
  );
}

export function ChecklistPopoverContent({ onClose }: { onClose?: () => void }) {
  const { done, total, rows, crew, collected, finished } = useChecklistState();

  if (finished) return null;

  return (
    <>
      <CatchStyles />
      <ChecklistPanel
        done={done}
        total={total}
        crew={crew}
        rows={rows}
        showAvatars={done > 0}
        revealAvatars={done === 1 && collected !== null}
        onCollapse={onClose}
        embedded
      />
    </>
  );
}

export function GettingStartedChecklist() {
  const { done, total, rows, crew, collected, celebrating, variant, finished } =
    useChecklistState();
  const [expanded, setExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        expanded &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    },
    [expanded],
  );

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  if (finished) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-4 right-[4.5rem] z-[60] flex flex-col items-end gap-3"
    >
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
      ) : null}
    </div>
  );
}
