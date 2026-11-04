import "./getting-started.css";

import type { GettingStartedTask } from "api-server-api";
import { useContext, useEffect, useRef } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DrawerPanelContext } from "@/components/ui/side-drawer";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  SIDEBAR_ITEM,
  sidebarItemTone,
} from "../../platform/components/sidebar/sidebar-nav-item.js";
import {
  useMarkUnlockSeen,
  useSetChecklistDismissed,
} from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";
import { useStartTask } from "../hooks/use-start-task.js";
import { deriveChecklist } from "../lib/derive-checklist.js";
import { ChecklistPanel } from "./checklist-panel.js";
import { ProgressRing } from "./progress-ring.js";
import { UnlockCelebration } from "./unlock-celebration.js";

interface Props {
  expanded: boolean;
  inDrawer?: boolean;
  onNavigate?: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Get started checklist as a sidebar footer
 * item: a progress ring and its label, or the ring alone on the collapsed
 * rail, named with the progress and the unlocks the user has not seen. A click
 * opens the checklist in a popover beside it, which lists the tasks that
 * unlock the avatar characters and plays the celebration for each unseen
 * unlock, one at a time, in place of the list, taking the keyboard with it. A
 * click elsewhere, Escape or its close button closes it back to the item;
 * Dismiss hides it until the next unlock or until the avatar picker asks for
 * it, and it is gone once every character is unlocked, until the user resets
 * their onboarding progress. The footer exists twice when the mobile drawer is
 * open, so only the copy the media query says is on screen anchors the
 * popover, and it drops the open flag when it leaves the screen or the drawer
 * closes, so nothing opens unasked. A checklist that leaves the page, because
 * every character is unlocked or another tab dismissed it, drops the open flag
 * with it too.
 */
export function GettingStartedNavItem({
  expanded,
  inDrawer = false,
  onNavigate,
}: Props) {
  const onScreen = useIsDesktop() !== inDrawer;
  const drawerPanel = useContext(DrawerPanelContext);
  const progress = useGettingStarted().data;
  const open = useStore((s) => s.checklistExpanded);
  const setOpen = useStore((s) => s.setChecklistExpanded);
  const markSeen = useMarkUnlockSeen();
  const setDismissed = useSetChecklistDismissed();
  const startTask = useStartTask();

  const checklist = progress ? deriveChecklist(progress) : null;
  const visible =
    checklist !== null && !checklist.complete && !checklist.dismissed;
  const celebrating = checklist?.celebrating ?? null;
  const phase = celebrating?.unlock.task ?? "checklist";

  const content = useRef<HTMLDivElement>(null);
  const wasPhase = useRef(phase);
  const wasOnScreen = useRef(onScreen);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible, setOpen]);

  useEffect(() => {
    if (wasOnScreen.current && !onScreen) setOpen(false);
    wasOnScreen.current = onScreen;
  }, [onScreen, setOpen]);

  useEffect(() => {
    if (!inDrawer) return undefined;
    return () => setOpen(false);
  }, [inDrawer, setOpen]);

  useEffect(() => {
    if (wasPhase.current === phase) return;
    wasPhase.current = phase;
    content.current?.querySelector<HTMLElement>("button")?.focus();
  }, [phase]);

  if (!onScreen || !checklist || !visible) return null;
  if (inDrawer && !drawerPanel) return null;

  const done = checklist.unlocked.length;
  const total = checklist.rows.length;
  const unseen = progress?.unlocks.filter((unlock) => !unlock.seen).length ?? 0;
  const label = `Get started, ${String(done)} of ${String(total)} done${
    unseen > 0 ? `, ${String(unseen)} new avatar${unseen === 1 ? "" : "s"}` : ""
  }`;

  const close = () => setOpen(false);
  const dismiss = () => {
    close();
    setDismissed.mutate({ dismissed: true });
  };
  const start = (task: GettingStartedTask) => {
    close();
    onNavigate?.();
    void startTask(task);
  };

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        data-testid="getting-started-item"
        aria-label={label}
        className={cn(SIDEBAR_ITEM, "relative", sidebarItemTone(open))}
      >
        <span className="relative flex">
          <ProgressRing done={done} total={total} className="size-4" />
          {unseen > 0 && (
            <span
              data-testid="getting-started-unseen"
              className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white"
            >
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
        </span>
        {expanded && (
          <span className="truncate text-sm font-medium">Get started</span>
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {expanded ? (
        trigger
      ) : (
        <Tooltip content="Get started" side="right">
          {trigger}
        </Tooltip>
      )}
      <PopoverContent
        container={inDrawer ? drawerPanel : undefined}
        side="right"
        align="end"
        tail={false}
        aria-label="Get started"
        data-testid="getting-started-popover"
        className="getting-started animate-in border-0 bg-transparent p-0 shadow-none"
      >
        <div
          ref={content}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            close();
          }}
        >
          {celebrating ? (
            <UnlockCelebration
              key={celebrating.unlock.task}
              character={celebrating.unlock.character}
              variant={celebrating.variant}
              onFinished={() =>
                markSeen.mutate({ task: celebrating.unlock.task })
              }
            />
          ) : (
            <ChecklistPanel
              rows={checklist.rows}
              onClose={close}
              onDismiss={dismiss}
              onStart={start}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
