# Chat + Menu — Developer Scope

## Overview

Replace the chat input's `DropdownMenu` (navigate-to-configure) with a `Popover` that lets users manage Skills, Schedules, and Connections inline — without leaving the chat view.

**Prototype branch:** `worktree-feat+unified-agent-setup`  
**Flow spec:** [`docs/plus-menu-flow-spec.md`](plus-menu-flow-spec.md)  
**Prototype component:** [`src/modules/sessions/components/plus-menu-popover.tsx`](../src/modules/sessions/components/plus-menu-popover.tsx)

---

## What the prototype already does (no dev work needed)

| Area | Status |
|---|---|
| Level 1 menu (Attach file, Skills, Schedules, Connections) | Working — icons, badges, click targets |
| Skills panel — grouped by source, toggle switches, "Always on" for standalone | Working — reuses `useSkillsSurface` + `useSkillsDerivations` |
| Schedules panel — cadence subtitle, overflow menu, enable/disable | Working with mock data |
| Connections panel — grouped by provider, status badges, overflow menus | Working — reuses `ConnectionGroupCard`, `useCatalogGroups`, `useConnectionMaintenance` |
| Panel transitions (CSS translateX slide) | Working |
| Search within each panel (shown when count > 6) | Working |
| Skeleton loading states | Working |
| Empty states | Working |
| Toast notifications on every toggle/delete | Working via `emitToast` |
| Light + dark theme | Verified via headless screenshots |

---

## What needs dev work

### P0 — Ship blockers

#### 1. Wire Schedules to real data
**Files:** `plus-menu-popover.tsx` → `useAgentSchedules`  
**Current:** Reads from `mockSchedules` static array, filters by `agentId`.  
**Needed:** Replace with the same tRPC query used in the Schedules page (`api.schedules.list`). The `Schedule` type is already imported.  
**Toggle handler:** Call `api.schedules.update({ id, enabled })` instead of local `useState`.  
**Delete handler:** Call `api.schedules.delete({ id })` instead of just showing a toast.

#### 2. ~~Wire Connections to real data~~ ✅ Done in prototype
**Files:** `plus-menu-popover.tsx`  
**Done:** Replaced mock arrays with `useAppConnections` + `useAgentConnections` + `excludeProviderConnections` + `useCatalogGroups`. Renders `ConnectionGroupCard` per provider group. Uses `useSetAgentConnections` for grant/revoke. `ConnectionCatalogModal` and `ConnectionMaintenanceDialog` lifted outside the Popover (z-index). Mock handler supports `setAgentConnections` mutation.

#### 3. ~~Remove mock connection imports~~ ✅ Done
**Files:** `plus-menu-popover.tsx`  
**Done:** All `mock/data/connections.js` imports removed. Only `mock/data/schedules.js` remains (schedules still use mock data). Deleted `MockConnection`, `ConnectionPanelRow`, `ConnectionGroup`, mock `useAgentConnections`, `useConnectionIconSlug`.

#### 4. Confirm dialog for revoking mid-task
**Flow spec section:** "Confirm dialog: revoking mid-task"  
**Current:** Not implemented — toggle just fires immediately.  
**Needed:** When agent status is `running` and user turns OFF a connection, show a confirmation dialog before calling the revoke API. Reuse the existing `AlertDialog` pattern.

### P1 — Post-ship enhancements

#### 5. "Using skill" chip in chat input
**Flow spec section:** "Using {skill} chip behavior"  
**Current:** `onInsertSkillChip` prop is passed through but `ChatInput` doesn't consume it yet.  
**Needed:** When a skill name is clicked in the Skills panel, insert a removable chip badge into the chat input. On send, chips convert to `[Using: skill1, skill2]` text prefix. Requires changes to `ChatInput` state (draft model) and send logic.

#### 6. Slash-command shortcut (`/` opens + menu)
**Flow spec section:** "Slash-command shortcut"  
**Current:** Not implemented.  
**Needed:** When textarea is empty and user types `/`, open the popover with a filter input. Requires coordination between `ChatInput` keydown handler and `PlusMenuPopover` open state.

#### 7. Schedule overflow menu actions
**Current:** Menu items ("Edit schedule", "View results", "Reset session", "Delete") are UI-only — they show in the dropdown but don't do anything real except Delete (which just shows a toast).  
**Needed:** Wire each to the appropriate navigation or API call.

#### 8. "Describe it" → prefill chat input
**Current:** `onPrefillInput` prop is passed through but `ChatInput` doesn't consume it yet.  
**Needed:** When clicked, close the popover and set the draft text to `"Create a schedule that "` with cursor at end.

---

## Component architecture

```
chat-input.tsx
  └─ PlusMenuPopover (new — plus-menu-popover.tsx)
       ├─ MenuRoot           — Level 1 rows with badge counts
       ├─ SkillsPanel        — real hooks (useSkillsSurface + useSkillsDerivations)
       │    ├─ SkillGroup     — section with label
       │    └─ SkillPanelRow  — name + switch
       ├─ SchedulesPanel     — needs real data hook
       │    ├─ SchedulePanelRow    — name, cadence, overflow, switch
       │    └─ ScheduleOverflowMenu
       └─ ConnectionsPanel   — real hooks (useAppConnections + useCatalogGroups)
            └─ ConnectionGroupCard — reused from connections module (grouped by provider)
```

Shared sub-components: `PanelHeader`, `SearchInput`, `PanelEmpty`, `SkeletonRows`, `MenuRow`.

---

## Hooks to replace

| Prototype hook | What it does | Replace with |
|---|---|---|
| `useAgentSchedules(agentId)` | Filters `mockSchedules` by agentId | tRPC `api.schedules.list({ agentId })` |
| ~~`useAgentConnections(agentId)`~~ | ~~Splits mock arrays into granted/available~~ | ✅ Replaced — uses real `useAgentConnections` + `useAppConnections` + `excludeProviderConnections` + `useCatalogGroups` |
| ~~`useConnectionCount(agentId)`~~ | ~~Returns `mockAgentConnections.length`~~ | ✅ Replaced — derived from real granted connections; also exposes `hasBroken` for danger badge |
| ~~`useConnectionIconSlug(templateId)`~~ | ~~Finds icon slug in `mockTemplates`~~ | ✅ Deleted — `ConnectionGroupCard` handles icons internally |
| `useScheduleCount(agentId)` | Counts enabled in mock | Derived from real schedules query |
| `useSkillCount(agentId)` | Already real — uses `useSkillsSurface` | No change needed |

---

## Files changed in prototype

| File | Change |
|---|---|
| `src/modules/sessions/components/plus-menu-popover.tsx` | **New** — 795 lines, the entire + menu |
| `src/modules/sessions/components/chat-input.tsx` | Replaced `DropdownMenu` block with `<PlusMenuPopover>` |

---

## Screenshots

All states captured in `/tmp/plus-{theme}-{nn}-{state}.png`:

| # | State | Light | Dark |
|---|---|---|---|
| 01 | Chat baseline (+ button visible) | `plus-light-01-chat.png` | `plus-dark-01-chat.png` |
| 02 | + menu open (4 rows with badges) | `plus-light-02-menu.png` | `plus-dark-02-menu.png` |
| 03 | Skills panel (grouped, toggles) | `plus-light-03-skills.png` | `plus-dark-03-skills.png` |
| 04 | Schedules panel (cadence, overflow) | `plus-light-04-schedules.png` | `plus-dark-04-schedules.png` |
| 05 | Connections panel (granted/available, status badges) | `plus-light-05-connections.png` | `plus-dark-05-connections.png` |
| 06 | After toggle (toast notification) | `plus-light-06-toggle.png` | `plus-dark-06-toggle.png` |

---

## Effort estimate

| Item | Size | Notes |
|---|---|---|
| Wire schedules to real data | S | Pattern exists in schedules page |
| Wire connections to real data | M | Grant/revoke flow + contribution fanout from connections-section |
| Confirm dialog (revoke mid-task) | S | Reuse AlertDialog |
| Remove mock imports | XS | Delete 4 import lines |
| "Using skill" chip | M | New draft model feature in ChatInput |
| Slash-command shortcut | M | KeyDown coordination between textarea and popover |
| Schedule overflow actions | S | Wire existing navigation/API calls |
| Prefill chat input | XS | Set draft text on click |

**P0 total:** ~S+M = **~2–3 days**  
**P1 total:** ~M+M+S+XS = **~3–4 days**
