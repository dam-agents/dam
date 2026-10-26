import "./getting-started.css";

import { useCallback, useState } from "react";

import { SideDrawer, SideDrawerHeader } from "@/components/ui/side-drawer";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useMarkUnlockSeen } from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";
import { useStartTask } from "../hooks/use-start-task.js";
import { deriveChecklist } from "../lib/derive-checklist.js";
import { ChecklistPanel } from "./checklist-panel.js";
import { UnlockCelebration } from "./unlock-celebration.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist's rows, in the frame
 * its side panel and its drawer both give it. It lists the tasks that unlock
 * the avatar characters and plays the celebration for each unlock the user has
 * not seen, one at a time, then records it as seen; a celebration only plays
 * where the checklist is open, so it never covers the page.
 */
function Checklist() {
  const progress = useGettingStarted().data;
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const markSeen = useMarkUnlockSeen();
  const startTask = useStartTask();

  const checklist = progress ? deriveChecklist(progress) : null;
  const celebrating = checklist?.celebrating ?? null;

  const finishCelebration = useCallback(() => {
    if (!celebrating) return;
    markSeen.mutate({ task: celebrating.unlock.task });
  }, [celebrating, markSeen]);

  if (!checklist) return null;
  return (
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
          showRewards={checklist.unlocked.length > 0}
          onStart={(task) => {
            setMobileScreen("chat");
            void startTask(task);
          }}
        />
      )}
    </div>
  );
}

export function GettingStartedPanel({ className }: { className?: string }) {
  return (
    <SidebarSection
      title="Get started"
      open
      className={cn("getting-started", className)}
    >
      <Checklist />
    </SidebarSection>
  );
}

export function GettingStartedDrawer({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  return (
    <SideDrawer
      side="right"
      label="Get started"
      closing={closing}
      onClose={requestClose}
      onClosed={onClose}
      className="getting-started max-w-[420px]"
    >
      <SideDrawerHeader title="Get started" onClose={requestClose} />
      <Checklist />
    </SideDrawer>
  );
}
