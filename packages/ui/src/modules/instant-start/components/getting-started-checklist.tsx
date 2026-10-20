import { useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { CatchStyles } from "../../agents/components/catch-styles.js";
import {
  CHAR_NAMES,
  CharAvatar,
  type CharName,
} from "../../agents/components/char-avatar.js";
import {
  CHARACTER_QUESTS,
  completeQuest,
  endCelebration,
  FIRST_AGENT_QUEST_ID,
  useCharacterUnlocks,
} from "../../agents/lib/character-unlocks.js";
import {
  CatchCelebration,
  ChecklistPanel,
  ChecklistPill,
  type CatchVariant,
  type CrewSlotData,
  type QuestRowData,
} from "../../avatar-sheet/getting-started-checklist.js";

export function GettingStartedChecklist() {
  const { caught, rewards, working, celebrating, collected } =
    useCharacterUnlocks();
  const [expanded, setExpanded] = useState(true);
  const bootRef = useRef(false);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    completeQuest(FIRST_AGENT_QUEST_ID);
  }, []);

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
