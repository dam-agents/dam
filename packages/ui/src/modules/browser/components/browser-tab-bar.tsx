import { Checkmark, ChevronDown } from "@carbon/icons-react";
import type { TabState } from "agent-runtime-api";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

import { tabLabel, tabWidths } from "../lib/tabs.js";
import { BrowserTab } from "./browser-tab.js";

interface Props {
  tabs: TabState[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the browser panel's tab bar: the tabs of the
 * agent's one browser, the one on screen marked, each selected and closed by
 * its target id. As in Safari, the tabs share the bar's width evenly; when
 * that is too narrow to read a title, the active tab keeps a readable width
 * and the others shrink to share the rest, down to a minimum, then scroll,
 * keeping the active one in view. The list button beside them reaches every
 * tab when the bar is too narrow to show them. Arrow keys, Home and End move
 * between tabs from the focused tab, as in any tab list; Delete closes the
 * focused tab and moves focus to its neighbour, and a middle click closes one
 * too.
 */
export function BrowserTabBar({ tabs, activeTab, onSelect, onClose }: Props) {
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
  const tabStop = tabs.some((t) => t.id === activeTab)
    ? activeTab
    : tabs[0]?.id;

  const revealActive = useCallback(() => {
    if (!activeTab) return;
    triggers.current
      .get(activeTab)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  useEffect(revealActive, [revealActive, tabs.length]);

  useEffect(() => {
    if (!list) return;
    const ro = new ResizeObserver(([entry]) =>
      setListWidth(entry.contentRect.width),
    );
    ro.observe(list);
    return () => ro.disconnect();
  }, [list]);

  const widths =
    listWidth === null
      ? undefined
      : tabWidths(
          listWidth,
          tabs.length,
          tabs.findIndex((t) => t.id === activeTab),
        );

  function handleKeyDown(event: KeyboardEvent, focused: string) {
    const at = tabs.findIndex((t) => t.id === focused);
    if (event.key === "Delete") {
      event.preventDefault();
      const neighbour = tabs[at + 1] ?? tabs[at - 1];
      onClose(focused);
      if (neighbour) triggers.current.get(neighbour.id)?.focus();
      return;
    }
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
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2"
    >
      <div
        ref={setList}
        role="tablist"
        aria-label="Tabs in the agent's browser"
        onWheel={handleWheel}
        onTransitionEnd={(e) => e.propertyName === "width" && revealActive()}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab, i) => (
          <BrowserTab
            key={tab.id}
            tab={tab}
            width={widths?.[i]}
            active={tab.id === activeTab}
            focusable={tab.id === tabStop}
            triggerRef={(node) => {
              if (node) triggers.current.set(tab.id, node);
              else triggers.current.delete(tab.id);
            }}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, tab.id)}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center">
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
