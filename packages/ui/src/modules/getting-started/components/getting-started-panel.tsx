import "./getting-started.css";

import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import {
  useMarkUnlockSeen,
  useSetChecklistDismissed,
} from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";
import { useStartTask } from "../hooks/use-start-task.js";
import { deriveChecklist } from "../lib/derive-checklist.js";
import { ChecklistPanel } from "./checklist-panel.js";
import { UnlockCelebration } from "./unlock-celebration.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started side panel. It lists the tasks
 * that unlock the avatar characters and plays the celebration for each unlock
 * the user has not seen, one at a time, at its top, then records it as seen.
 * An unlock only plays while the panel is open, so it never covers the page;
 * until then the panel's icon counts it. Dismissing the checklist closes the
 * panel and hides its icon until the next unlock or until the avatar picker
 * asks for it.
 */
export function GettingStartedPanel({ className }: { className?: string }) {
  const progress = useGettingStarted().data;
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
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
    markSeen.mutate({ task: celebrating.unlock.task });
  }, [celebrating, markSeen]);

  return (
    <SidebarSection
      title="Get started"
      open
      className={cn("getting-started", className)}
    >
      {checklist && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {celebrating && (
            <UnlockCelebration
              key={celebrating.unlock.task}
              character={celebrating.unlock.character}
              variant={celebrating.variant}
              onFinished={finishCelebration}
            />
          )}
          {!checklist.dismissed && (
            <ChecklistPanel
              rows={checklist.rows}
              unlocked={checklist.unlocked}
              justUnlocked={justUnlocked}
              onDismiss={() => {
                setDismissed.mutate({ dismissed: true });
                setSidePanelTab(null);
              }}
              onStart={(task) => {
                setMobileScreen("chat");
                void startTask(task);
              }}
            />
          )}
        </div>
      )}
    </SidebarSection>
  );
}
