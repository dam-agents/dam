import "./getting-started.css";

import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useMarkUnlockSeen,
  useSetChecklistDismissed,
} from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";
import { useStartTask } from "../hooks/use-start-task.js";
import { deriveChecklist } from "../lib/derive-checklist.js";
import { ChecklistPanel } from "./checklist-panel.js";
import { ChecklistPill } from "./checklist-pill.js";
import { UnlockCelebration } from "./unlock-celebration.js";

const PLACEMENT = {
  page: "fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-4",
  chat: "absolute right-3 bottom-14 md:bottom-3",
} as const;

interface Props {
  placement: keyof typeof PLACEMENT;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist, docked in the lower
 * right corner. It lists the tasks that unlock the avatar characters, plays
 * the celebration for each new unlock, and collapses to a pill. Dismissing it
 * hides it until the next unlock or until the avatar picker asks for it; it
 * is gone once every character is unlocked, until the user resets their
 * onboarding progress. While a celebration
 * plays, the checklist shows as the pill, so both fit on a short screen. On a
 * page it is fixed to
 * the window, above the mobile navigation bar. In the chat it sits inside the
 * message area, so it never covers the composer below it.
 */
export function GettingStartedDock({ placement }: Props) {
  const progress = useGettingStarted().data;
  const expanded = useStore((s) => s.checklistExpanded);
  const setExpanded = useStore((s) => s.setChecklistExpanded);
  const markSeen = useMarkUnlockSeen();
  const setDismissed = useSetChecklistDismissed();
  const startTask = useStartTask();
  const [justUnlocked, setJustUnlocked] = useState<AvatarCharacter | null>(
    null,
  );

  const checklist = progress ? deriveChecklist(progress) : null;
  const celebrating = checklist?.celebrating ?? null;

  const finishCelebration = useCallback(() => {
    if (!celebrating) return;
    setJustUnlocked(celebrating.unlock.character);
    if (celebrating.unlock.task === "create-agent") setExpanded(true);
    markSeen.mutate({ task: celebrating.unlock.task });
  }, [celebrating, markSeen, setExpanded]);

  if (!checklist) return null;
  if (checklist.complete) return null;
  if (checklist.dismissed && !celebrating) return null;

  const dismiss = () => setDismissed.mutate({ dismissed: true });

  return (
    <div
      className={cn(
        "getting-started-dock pointer-events-none z-raised flex flex-col items-end gap-3",
        PLACEMENT[placement],
      )}
    >
      {celebrating && (
        <div className="pointer-events-auto">
          <UnlockCelebration
            key={celebrating.unlock.task}
            character={celebrating.unlock.character}
            variant={celebrating.variant}
            onFinished={finishCelebration}
          />
        </div>
      )}
      {!checklist.dismissed && (
        <div className="pointer-events-auto">
          {expanded && !celebrating ? (
            <ChecklistPanel
              rows={checklist.rows}
              unlocked={checklist.unlocked}
              justUnlocked={justUnlocked}
              onCollapse={() => setExpanded(false)}
              onDismiss={dismiss}
              onStart={(task) => void startTask(task)}
            />
          ) : (
            <ChecklistPill
              key={justUnlocked ?? "none"}
              done={checklist.unlocked.length}
              total={checklist.rows.length}
              pulse={justUnlocked !== null}
              onExpand={() => setExpanded(true)}
              onDismiss={dismiss}
            />
          )}
        </div>
      )}
    </div>
  );
}
