# 02 — Agent view and one Sessions list

**Part of:** Left nav: one list of sessions — see [README](./README.md)

## Context

The core of #6744: Agents stop nesting their sessions, Activity becomes Sessions — the only session list — and a click on an Agent narrows the nav to that Agent (README decisions 1, 2, 3, 10, 11). No pins yet; rows keep the menus they have today until 03.

## Implementation plan

Apply `/react-ui-engineering`. All paths under `packages/ui/src/modules/`.

1. **State** — `platform/store/sidebar.ts`: add `sidebarAgent: string | null` (initial `null`, not persisted) and `setSidebarAgent(id | null)`. Remove `sidebarAgentOpen` / `setSidebarAgentOpen` and every caller. In `platform/store/navigation.ts`, where the shown chat changes agent, clear `sidebarAgent` when the new `selectedAgent` differs from it (decision 1) — the nav's own clicks set `sidebarAgent` first, so they are unaffected.
2. **Fold rules** — `agents/lib/sidebar-agent-order.ts`: drop `sidebarAgentOpen`; `sidebarAgentFolded` folds a hibernated Agent unless it is `sidebarAgent`. Update `agents/hooks/use-sidebar-agents.ts` (`isOpen`, `sessionsOf`, `previewComplete` go; `openAgentId` stays for the selected mark).
3. **Agents section** — `agents/components/sidebar-agents.tsx`:
   - All agents (`sidebarAgent === null`): rows as today, without `SidebarAgentSessions` children and without the `filter` slot; click → `setSidebarAgent(id)` + `startSession(id)` + `onNavigate`. Keep unread dot, drag order, New session / Agent settings / ⋮ actions, hibernated fold. A filtered Agent keeps its mark (pass `filtered`, drop the menu).
   - Agent view: a "← All agents" button (`setSidebarAgent(null)`), then only the selected Agent's row, highlighted (`selected`); click → `startSession(id)`; no drag, no fold.
   - `agents/components/sidebar-agent-row.tsx`: remove the expand/children and filter slots; adapt `actionCount`.
   - `agents/components/sidebar-shared-agents.tsx`: same click rule for rows with `holds(access, "sessions")` (agent view); others still open settings; render nothing in an agent view unless the selected Agent is shared, in which case `sidebar-agents.tsx` shows it as the selected row (decision 3).
4. **Sessions section** — rename `home/components/sidebar-activity.tsx` → `sessions/components/sidebar-sessions.tsx` (`SidebarSessions`, `aria-label="Sessions"`, label "Sessions", `data-testid="sidebar-sessions"`):
   - All agents: today's attention-record list and `sidebarActivityFilters` filter, rows with agent name. Empty state when the user has Shared Agents and nothing is listed: "Sessions on agents shared with you show when you open the agent."
   - Agent view: `AgentSessionList` for `sidebarAgent` (export it from `sessions/components/sidebar-agent-sessions.tsx`, keep its paging/fill/focus/FilterNote/Rename/Delete/telemetry), with the header filter bound to `useAgentSessionFilter(id)` / `setAgentSessionFilter`. Rows omit the agent name. Delete `SessionPreview` and the preview path — the record is shown only in All agents now.
   - Opening a session never changes `sidebarAgent`.
5. **Layout** — `platform/components/sidebar/sidebar-content.tsx`: Agents, Shared with me (All agents only), Sessions; testids `sidebar-sessions-section`. `platform/components/sidebar/sidebar.tsx` `CollapsedRail`: the Activity flyout becomes "Sessions" (same badge) rendering `SidebarSessions`; the Agents flyout renders the agents sections; a click in it sets the view and closes it.
6. **Wake** — keep the once-per-open wake (`agents/hooks/use-auto-wake-on-sidebar-open.ts`) keyed on `sidebarAgent` instead of the open overrides.
7. **Tests** — update the unit tests that assert removed behaviour (`sidebar-agent-sessions`, `sidebar-expanded-default`, `sidebar-agent-click`, `sidebar-layout`, `sidebar-open-session-highlight`, `sidebar-view-more-*`, `sidebar-side-panel-expanded`) and e2e selectors on `sidebar-activity`; do not add new ones.
8. **Docs** — rewrite the sidebar paragraphs of `docs/architecture/home-feed.md` (l.7, 56–90): nested lists → agent view, Activity → Sessions, filters per view, Shared with me. Glossary: _Retired words_ row "Activity (the sidebar's session list) → Sessions" in `docs/ubiquitous-language.md` and the same in `design.retired_words` of `.quality-inspector/qi-profile-dam/profile.json`.

## Acceptance criteria

- [ ] No Agent row expands or lists sessions; the only session list is "Sessions".
- [ ] Clicking an Agent hides the others and Shared with me, shows "← All agents", opens its new chat, and lists only its sessions (its own list, paged), without agent names.
- [ ] In the agent view the header filter is that Agent's saved filter; in All agents it is the global one; neither changes the other.
- [ ] Opening a session from All agents keeps All agents; "← All agents" keeps the open session open.
- [ ] Opening a session of another Agent from the approvals bell while in an agent view switches the nav to All agents.
- [ ] A Shared Agent with session access opens its agent view; one without opens settings.
- [ ] Collapsed rail: Sessions flyout and Agents flyout behave as above.
- [ ] Reload opens All agents.
- [ ] `mise run test`, `mise run check`, `check:format`, `check:lint` pass.

## Smoke test

`mise run cluster:install` (or rebuild the UI on a running cluster), open the UI in agent-browser and walk README smoke steps 1, 2 and 7 plus the approvals-bell case; `mise run test --filter ui` for the updated unit tests. Then print the manual steps for the user.
