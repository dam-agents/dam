import "./getting-started.css";

import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { useCallback, useState } from "react";

import { useIsDesktop } from "@/hooks/use-is-desktop";
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
  rail: { desktop: true, popover: "right-full bottom-0 mr-2", tooltip: "left" },
  header: {
    desktop: false,
    popover: "fixed right-4 top-[60px]",
    tooltip: "bottom",
  },
} as const;

interface Props {
  placement: keyof typeof PLACEMENT;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist. It lists the tasks
 * that unlock the avatar characters, plays the celebration for each new
 * unlock, and collapses to a progress ring beside the approvals bell.
 * Dismissing it hides it until the next unlock or until the avatar picker
 * asks for it; it is gone once every character is unlocked, until the user
 * resets their onboarding progress. While a celebration plays, the checklist
 * stays collapsed. On a wide screen the ring sits in the icon bar on the
 * right, above the bell, and the checklist opens to its left; on a phone it
 * sits in the top bar and the checklist opens below it. Only the placement
 * that matches the screen renders, so the celebration plays once.
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

  const desktop = useIsDesktop();
  const at = PLACEMENT[placement];

  const checklist = progress ? deriveChecklist(progress) : null;
  const celebrating = checklist?.celebrating ?? null;

  const finishCelebration = useCallback(() => {
    if (!celebrating) return;
    setJustUnlocked(celebrating.unlock.character);
    if (celebrating.unlock.task === "create-agent") setExpanded(true);
    markSeen.mutate({ task: celebrating.unlock.task });
  }, [celebrating, markSeen, setExpanded]);

  if (!checklist || desktop !== at.desktop) return null;
  if (checklist.complete) return null;
  if (checklist.dismissed && !celebrating) return null;

  const dismiss = () => setDismissed.mutate({ dismissed: true });

  const open = expanded && !celebrating && !checklist.dismissed;

  return (
    <div className="getting-started-dock relative">
      {!checklist.dismissed && (
        <ChecklistPill
          key={justUnlocked ?? "none"}
          done={checklist.unlocked.length}
          total={checklist.rows.length}
          pulse={justUnlocked !== null}
          expanded={open}
          tooltipSide={at.tooltip}
          onToggle={() => setExpanded(!open)}
        />
      )}
      {(celebrating || open) && (
        <div
          className={cn(
            "absolute z-raised flex flex-col items-end gap-3",
            at.popover,
          )}
        >
          {celebrating && (
            <UnlockCelebration
              key={celebrating.unlock.task}
              character={celebrating.unlock.character}
              variant={celebrating.variant}
              onFinished={finishCelebration}
            />
          )}
          {open && (
            <ChecklistPanel
              rows={checklist.rows}
              unlocked={checklist.unlocked}
              justUnlocked={justUnlocked}
              onCollapse={() => setExpanded(false)}
              onDismiss={dismiss}
              onStart={(task) => void startTask(task)}
            />
          )}
        </div>
      )}
    </div>
  );
}
