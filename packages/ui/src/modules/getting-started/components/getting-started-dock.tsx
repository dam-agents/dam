import "./getting-started.css";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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

const PANEL_POSITION = {
  corner: "top-[82px] right-4 md:right-6",
  bar: "top-[60px] right-4 md:top-[78px] md:right-6",
} as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist. It lists the tasks
 * that unlock the avatar characters, plays the celebration for each unlock the
 * user has not seen, and collapses to a progress ring. A click on the ring is
 * the only thing that opens it; a click elsewhere on the page, Escape, its
 * collapse chevron or Dismiss closes it, so it never holds a button of the
 * page it covers. While it is closed, a count on the ring shows the unlocks it
 * holds. Dismissing it hides it until the next unlock or until the avatar
 * picker asks for it; it is gone once every character is unlocked, until the
 * user resets their onboarding progress. Where its page puts it decides its
 * place: in a page's corner it hangs in the band under the approvals bell, and
 * the open card hangs under the ring; in a top bar both hang under the bar. A
 * page that scrolls passes under the card either way. The card takes the
 * keyboard while it is open and gives it back to the ring when it closes, as
 * the drawer it replaces did; it does not trap the keyboard, because the page
 * stays reachable and a click there closes it.
 */
export function GettingStartedDock({
  placement,
}: {
  placement: keyof typeof PANEL_POSITION;
}) {
  const progress = useGettingStarted().data;
  const expanded = useStore((s) => s.checklistExpanded);
  const setExpanded = useStore((s) => s.setChecklistExpanded);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const markSeen = useMarkUnlockSeen();
  const setDismissed = useSetChecklistDismissed();
  const startTask = useStartTask();
  const pill = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);

  const checklist = progress ? deriveChecklist(progress) : null;
  const celebrating = checklist?.celebrating ?? null;
  const visible =
    checklist !== null && !checklist.complete && !checklist.dismissed;
  const open = visible && expanded;
  const wasOpen = useRef(open);

  const close = useCallback(() => setExpanded(false), [setExpanded]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pill.current?.contains(target) || panel.current?.contains(target))
        return;
      close();
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

  return (
    <div ref={pill}>
      <ChecklistPill
        ref={ring}
        done={checklist.unlocked.length}
        total={checklist.rows.length}
        unseen={unseen}
        expanded={open}
        onToggle={() => setExpanded(!open)}
      />
      {open &&
        createPortal(
          <div
            ref={panel}
            data-testid="getting-started-dock-layer"
            className={cn(
              "getting-started-dock fixed z-raised flex flex-col items-end gap-3",
              PANEL_POSITION[placement],
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
            <ChecklistPanel
              ref={card}
              rows={checklist.rows}
              onCollapse={close}
              onDismiss={() => {
                close();
                setDismissed.mutate({ dismissed: true });
              }}
              onStart={(task) => {
                close();
                setMobileScreen("chat");
                void startTask(task);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
