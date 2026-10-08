# Chat + Menu — Flow Spec

## Open questions answered

| Question | Answer | Source |
|---|---|---|
| Does toggling a skill need a restart? | **No.** Skills are hot-pushed via `applyState` — the agent stays running. | `use-skills-surface.ts` toggle → `api.skills.install/uninstall` → `runtimeMutator.bump` → live delivery |
| Does toggling a connection need a restart? | **No.** Connections are applied live via the contribution fanout pipeline. The only restart scenario is a **gateway restart** when an egress rule adds L7 request inspection — and that has its own confirm dialog today. | `connections-section.tsx` toggleGrant → `setAgentConnections` → `contribution-fanout.ts` → live delivery |
| Should the + menu include Knowledge / Artifacts? | **No.** Files and Artifacts already live in the agent name popover (WorkspaceTabs). Keep the + menu focused: Attach file, Skills, Schedules, Connections. | `chat-workspace-variants.tsx` AgentMenuTrigger |
| Multiple "Using &lt;skill&gt;" chips in input? | **Yes.** Each skill-row click appends a separate chip. Multiple chips = multiple skills active for that message. Clicking the same skill again removes its chip. | — |
| Where does Attach file stay? | **First row**, unchanged. The file input, drag-and-drop, and paste flows are untouched. | `chat-input.tsx` existing behavior |

---

## Level 1 — The + menu

### Trigger
- Click the **+** button (left of the chat textarea)
- OR type **/** in an empty textarea → opens the same menu pre-filtered

### Appearance
A `Popover` (not DropdownMenu — we need sub-panels) anchored `side="top" align="start"` above the input. Width: **360px**.

### Rows (top to bottom)

| Row | Icon (16px) | Label | Badge | Action |
|---|---|---|---|---|
| Attach file | `Upload` | Attach file | — | Opens native file picker (existing behavior) |
| Skills | `SkillLevelAdvanced` | Skills | `"3 on"` muted pill | Opens Skills panel |
| Schedules | `Time` | Schedules | `"2 active"` muted pill | Opens Schedules panel |
| Connections | `ConnectionSignal` | Connections | `"4"` muted pill | Opens Connections panel |

Badge counts come from existing hooks:
- Skills: count of installed skill refs
- Schedules: count of enabled schedules
- Connections: count of granted connections (non-provider)

### Keyboard
- **Arrow up/down**: move highlight
- **Enter**: activate highlighted row
- **Escape**: close popover
- **/** in empty input: opens popover, places cursor in filter (filters rows by label substring)

### States
| State | Behavior |
|---|---|
| No agent selected | + button disabled (existing) |
| Agent loading | + button disabled; skeleton in badge counts |
| Normal | Full menu |

---

## Level 2 — Skills panel

### Entry
Click "Skills" row in Level 1. The popover content replaces the menu with a panel transition (slide-right animation, `150ms ease`).

### Header
`← Skills` (back arrow returns to Level 1 menu) | **"Manage"** text link (opens Configure page skills section)

### Search
Shown when total skill count > 6. Placeholder: `"Search skills..."`. Filters skill rows by name substring.

### Body (max 60vh, scrollable)
Skills grouped by source, matching the Configure page structure:

**Group: "{source name}"** — section label, muted  
Each skill row:
- Skill name (14px medium, truncated)
- Switch: on = installed, off = not installed
- Click the name → inserts `"Using {skill name}"` chip into the chat input
- Info icon (16px `Information`) → opens `SkillRenderModal` (existing skill preview)
- Drift indicator: when `hasDrift` is true, show accent "Update" badge (reuse `SkillRow` drift pattern)

Groups in order: "Created in this agent" → "Sourced from GitHub" → "Included with sandbox image" (built-in skills have no switch — always on)

### Footer
**"Add skill"** button. Click → sub-choices:
- "From GitHub" → opens `AddSkillSourceModal` (existing, tab: github)
- "Upload .md" → opens `AddSkillSourceModal` (existing, tab: upload)

### System line on toggle
> Skills updated — {skill name} turned on
> Skills updated — {skill name} turned off

### States

| State | What shows |
|---|---|
| Loading | 3 skeleton rows (pulse animation) in a single group |
| Empty (no sources) | Illustration + "No skills configured yet" + "Add skill" button |
| Error (source scan failed) | Source card with warning icon + "Couldn't scan — retry" |
| All filtered out | "No skills match '{query}'" |
| Read-only (viewer) | All switches hidden; name-only rows; no footer; no "Manage" link |
| Agent hibernating | Normal panel, switches work (changes hot-pushed on wake) |
| Agent mid-task | Normal panel, switches work (changes applied live, no restart) |

---

## Level 2 — Schedules panel

### Entry
Click "Schedules" row in Level 1.

### Header
`← Schedules` | **"Manage"** text link (navigates to Schedules view)

### Search
Shown when schedule count > 6. Placeholder: `"Search schedules..."`.

### Body
Each schedule row:
- **Name** (14px semibold, truncated)
- **Cadence subtitle** (14px muted): `"{cadence} · Next {time}"` — reuse `scheduleCadenceText()`
- **Switch**: enabled / disabled
- **Overflow menu** (3-dot): Edit schedule, View results, Reset session (if continuous mode), Delete (danger)

### Footer
Two actions side by side:
- **"Describe it"** (primary) → closes popover, pre-fills chat input with: `"Create a schedule that "` (cursor at end)
- **"Set it up myself"** (secondary/ghost) → opens Configure page schedules section

### System lines on actions
> Schedule updated — {name} enabled
> Schedule updated — {name} disabled
> Schedule deleted — {name}

### States

| State | What shows |
|---|---|
| Loading | 3 skeleton rows |
| Empty | "No schedules yet" + "Describe what you need and the agent will set one up" + "Describe it" button |
| Error | "Couldn't load schedules" + retry link |
| Read-only (viewer) | Switches hidden; no overflow menu; no footer |
| Agent hibernating | Normal panel; enabling a schedule is fine (it runs on its own cadence) |
| Agent mid-task | Normal panel, all actions available |

---

## Level 2 — Connections panel

### Entry
Click "Connections" row in Level 1.

### Header
`← Connections` | **"Manage"** text link (opens Configure page connections section)

### Search
Shown when total connection count > 6. Placeholder: `"Search connections..."`.

### Body
Connections grouped by provider using `ConnectionGroupCard` (reused from the connections module). Each group shows the provider icon + title + connection count header, followed by individual connection rows.

Each connection row (via `CatalogConnectionRow`):
- Provider icon (from template)
- Connection name (15px, truncated)
- Auth kind subtitle (e.g. "GitHub app", "Personal access token")
- `ConnectionStatusBadge` when not "active": "Expired" (danger), "Authorizing…" (muted), "Disconnected" (muted)
- Overflow ⋯ menu via `ConnectionRowActions`: Re-authenticate, Edit scope, Update credential, Remove from agent, Manage, Delete

Expired connections also show an inline "Re-authenticate" button.

### Broken connection indicator
Connections badge on Level 1 menu shows danger variant when any granted connection has status `"expired"` or `"disconnected"`. Overflow menu provides "Re-authenticate" and "Update credential" actions via `useConnectionMaintenance`.

### Footer
**"Add connection"** button → opens `ConnectionCatalogModal` (existing) with `sandbox` grant controls wired in so newly created connections are auto-granted.

### System lines on toggle
> Connection updated — {name} granted
> Connection updated — {name} removed

### States

| State | What shows |
|---|---|
| Loading | 3 skeleton rows |
| Empty (no connections at all) | "No connections configured" + "Add connection" button |
| Search with no match | "No connections match "{query}"" |
| Error | "Couldn't load connections" + retry link |
| Agent hibernating | Normal panel; granting is fine (applied on wake) |

---

## Chat system lines

Every mutation writes one notice message to the chat. Uses the existing `Message.notice` pattern:

```
<div class="flex justify-center">
  <span class="text-[11px] italic text-muted-foreground px-3 py-1 border-t border-b border-border/60">
    {text}
  </span>
</div>
```

No avatar, no timestamp, centered. Gray, small, quiet.

### Line templates
| Action | Text |
|---|---|
| Skill toggled on | `Skills updated — {name} turned on` |
| Skill toggled off | `Skills updated — {name} turned off` |
| Schedule enabled | `Schedule updated — {name} enabled` |
| Schedule disabled | `Schedule updated — {name} disabled` |
| Schedule deleted | `Schedule deleted — {name}` |
| Connection granted | `Connection updated — {name} granted` |
| Connection removed | `Connection updated — {name} removed` |

---

## Slash-command shortcut

When the textarea is empty and the user types `/`:
1. Open the + menu popover
2. Show a filter input at the top (auto-focused)
3. The 4 rows filter as the user types (substring match on label)
4. Arrow keys + Enter to select
5. Selecting "Skills" / "Schedules" / "Connections" navigates to that panel
6. Selecting "Attach file" opens the file picker
7. Escape or clearing the filter returns to normal typing

---

## "Using {skill}" chip behavior

When the user clicks a skill name in the Skills panel:
1. The popover closes
2. A chip `"Using {skill name}"` appears in the chat input (before the cursor position)
3. The chip is a small inline badge: `bg-muted rounded-full px-2 py-0.5 text-xs font-medium`
4. Clicking the chip's `×` removes it
5. Multiple chips allowed (one per skill)
6. Clicking the same skill name again while its chip is present removes the chip
7. When the message is sent, chips are converted to a text prefix: `"[Using: skill1, skill2] {message}"`

---

## Component architecture (for prototype)

```
chat-input.tsx
  └─ PlusMenuPopover (new)
       ├─ PlusMenuRoot         — Level 1 menu rows
       ├─ SkillsPanel          — Level 2 skills
       │    ├─ SkillGroupList   — grouped skill rows with switches
       │    └─ SkillPanelFooter
       ├─ SchedulesPanel       — Level 2 schedules
       │    ├─ ScheduleRowList  — schedule rows with switches + overflow
       │    └─ SchedulePanelFooter
       └─ ConnectionsPanel     — Level 2 connections (real hooks)
            └─ ConnectionGroupCard[] — reused, grouped by provider
  ConnectionCatalogModal        — rendered outside Popover (z-index)
  ConnectionMaintenanceDialog   — rendered outside Popover (z-index)
```

Single `Popover` component. Internal `panel` state: `"menu" | "skills" | "schedules" | "connections"`. Panel transitions use CSS translate animation. `ConnectionCatalogModal` and `ConnectionMaintenanceDialog` render as siblings after the `</Popover>` to avoid Radix z-index conflicts.
