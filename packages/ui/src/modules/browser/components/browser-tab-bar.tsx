import { Add, Checkmark, ChevronDown } from "@carbon/icons-react";
import type { TabState } from "agent-runtime-api";
import { type KeyboardEvent, useEffect, useRef, type WheelEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

import { tabLabel } from "../lib/tabs.js";
import { BrowserTab } from "./browser-tab.js";

interface Props {
  tabs: TabState[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the browser panel's tab bar: the tabs of the
 * agent's one browser, the one on screen marked, each selected and closed by
 * its target id. Tabs shrink to a minimum width, then scroll, keeping the
 * active one in view; the list button beside them reaches every tab when the
 * bar is too narrow to show them. Arrow keys, Home and End move between tabs
 * as in any tab list; Delete or a middle click closes one.
 */
export function BrowserTabBar({
  tabs,
  activeTab,
  onSelect,
  onClose,
  onNew,
}: Props) {
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const tabStop = tabs.some((t) => t.id === activeTab)
    ? activeTab
    : tabs[0]?.id;

  useEffect(() => {
    if (!activeTab) return;
    triggers.current
      .get(activeTab)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab, tabs.length]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Delete" && tabStop) {
      event.preventDefault();
      onClose(tabStop);
      return;
    }
    const at = tabs.findIndex((t) => t.id === tabStop);
    const step: Record<string, number | undefined> = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const to = step[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    triggers.current.get(next.id)?.focus();
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
      event.currentTarget.scrollLeft += event.deltaY;
  }

  return (
    <div
      data-testid="browser-tabs"
      className="flex h-9 shrink-0 items-end gap-1 border-b border-border bg-muted/40 px-2"
    >
      <div
        role="tablist"
        aria-label="Tabs in the agent's browser"
        onWheel={handleWheel}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <BrowserTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab}
            focusable={tab.id === tabStop}
            triggerRef={(node) => {
              if (node) triggers.current.set(tab.id, node);
              else triggers.current.delete(tab.id);
            }}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
            onKeyDown={handleKeyDown}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center self-center">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New tab"
          tooltip="New tab"
          onClick={onNew}
        >
          <Add size={16} />
        </Button>
        <DropdownMenu>
          <Tooltip content="All tabs">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="All tabs">
                <ChevronDown size={16} />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent className="max-w-80">
            {tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => onSelect(tab.id)}
                aria-current={tab.id === activeTab || undefined}
                className="gap-2"
              >
                <Checkmark
                  size={14}
                  aria-hidden
                  className={
                    tab.id === activeTab ? "shrink-0" : "invisible shrink-0"
                  }
                />
                <span className="truncate">{tabLabel(tab)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
