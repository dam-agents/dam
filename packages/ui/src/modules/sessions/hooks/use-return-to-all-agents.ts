import { type RefObject, useLayoutEffect } from "react";

import { useStore } from "../../../store.js";
import { shownSessionId } from "../lib/shown-session.js";

const agentRowSelector = (agentId: string) => {
  const id = CSS.escape(agentId);
  return `[data-testid="sidebar-agent-row"][data-agent-id="${id}"], [data-agent-id="${id}"] [data-testid="sidebar-shared-agent-row"]`;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: what "All agents" does once the full list
 * shows again, so the user keeps their place. The open Session's row is
 * scrolled into view, in Pinned or in Sessions, but only when that row is
 * already loaded: going back never asks for another page. Keyboard focus
 * moves from the "All agents" button, which is gone, to the row of the Agent
 * the user came from. Both happen once per click, inside this sidebar copy
 * only, never in the mobile drawer's or a flyout's.
 */
export function useReturnToAllAgents(
  listRef: RefObject<HTMLElement | null>,
): void {
  const backFrom = useStore((s) => s.sidebarBackFrom);
  const openSessionId = useStore((s) =>
    s.view === "chat" ? shownSessionId(s) : null,
  );
  useLayoutEffect(() => {
    if (backFrom === null) return;
    useStore.getState().setSidebarBackFrom(null);
    const list = listRef.current;
    if (!list) return;
    const sidebar = list.closest('[data-testid="sidebar-sections"]') ?? list;
    sidebar
      .querySelector<HTMLElement>(agentRowSelector(backFrom))
      ?.focus({ preventScroll: true });
    if (openSessionId === null) return;
    list
      .querySelector<HTMLElement>(
        `[data-testid="session-row"][data-session-id="${CSS.escape(openSessionId)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [backFrom, listRef, openSessionId]);
}
