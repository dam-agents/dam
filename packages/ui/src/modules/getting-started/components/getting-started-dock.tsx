import "./getting-started.css";

import { useCallback, useEffect, useRef } from "react";

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
  page: "fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] md:bottom-4",
  chat: "absolute right-3 bottom-14 md:bottom-3",
} as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist, docked in the lower
 * right corner. It lists the tasks that unlock the avatar characters, plays
 * the celebration for each unlock the user has not seen, and collapses to a
 * pill. A click on the pill is the only thing that opens it; a click
 * elsewhere on the page, Escape, its collapse chevron or Dismiss closes it, so
 * it never holds a button of the page it covers. While it is closed, a count
 * on the pill shows the unlocks it holds. Dismissing it hides it until the
 * next unlock or until the avatar picker asks for it; it is gone once every
 * character is unlocked, until the user resets their onboarding progress. On
 * a page it is fixed to the lower right corner of the window. In the chat it
 * sits inside the message area, so it never covers the composer below it. The
 * card takes the
 * keyboard while it is open and gives it back to the pill when it closes, as
 * the drawer it replaces did; it does not trap the keyboard, because the page
 * stays reachable and a click there closes it. A dock that leaves the page,
 * because every character is unlocked or another tab dismissed it, drops the
 * open flag with it, so the reset or the next unlock cannot open it unasked.
 */
export function GettingStartedDock({
  placement,
}: {
  placement: keyof typeof PLACEMENT;
}) {
  const progress = useGettingStarted().data;
  const expanded = useStore((s) => s.checklistExpanded);
  const setExpanded = useStore((s) => s.setChecklistExpanded);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const markSeen = useMarkUnlockSeen();
  const setDismissed = useSetChecklistDismissed();
  const startTask = useStartTask();
  const dock = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);

  const checklist = progress ? deriveChecklist(progress) : null;
  const celebrating = checklist?.celebrating ?? null;
  const visible =
    checklist !== null && !checklist.complete && !checklist.dismissed;
  const open = visible && expanded;
  const wasOpen = useRef(open);

  const close = useCallback(() => setExpanded(false), [setExpanded]);

  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible, setExpanded]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!dock.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) card.current?.focus();
    else ring.current?.focus();
  }, [open]);

  const finishCelebration = useCallback(() => {
    if (!celebrating) return;
    markSeen.mutate({ task: celebrating.unlock.task });
  }, [celebrating, markSeen]);

  if (checklist === null || checklist.complete || checklist.dismissed)
    return null;

  const unseen = progress?.unlocks.filter((unlock) => !unlock.seen).length ?? 0;

  const dismiss = () => {
    close();
    setDismissed.mutate({ dismissed: true });
  };

  return (
    <div
      ref={dock}
      className={cn(
        "getting-started-dock z-raised flex flex-col items-end gap-3",
        PLACEMENT[placement],
      )}
    >
      {open && celebrating && (
        <UnlockCelebration
          key={celebrating.unlock.task}
          character={celebrating.unlock.character}
          variant={celebrating.variant}
          onFinished={finishCelebration}
        />
      )}
      {open ? (
        <ChecklistPanel
          ref={card}
          rows={checklist.rows}
          onCollapse={close}
          onDismiss={dismiss}
          onStart={(task) => {
            close();
            setMobileScreen("chat");
            void startTask(task);
          }}
        />
      ) : (
        <ChecklistPill
          ref={ring}
          done={checklist.unlocked.length}
          total={checklist.rows.length}
          unseen={unseen}
          onExpand={() => setExpanded(true)}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
