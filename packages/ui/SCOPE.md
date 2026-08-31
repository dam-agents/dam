# Home Activity Feed Redesign — Scope

**Ticket**: dam#3478 (P0)
**Milestone**: September 9
**Branch**: `design/home-prototype`
**Run with**: `VITE_MOCK=true pnpm run dev` (or `.env` with `VITE_MOCK=true`)

---

## Problem

Approvals get buried under schedule runs. A user with a cron that fires every 20 minutes will come back to a feed dominated by schedule cards, with pending approvals invisible unless they scroll. The feed also has no date context — everything is a flat "X minutes ago" list — and no way to filter by session origin (chat, slack, scheduled, experiment).

## What this prototype implements

A working, clickable prototype of the redesigned Activity feed. Real product code running against mock fixtures. Interactions work end-to-end: filter, dismiss, approve, navigate.

### 1. Pinned approval summary row

A warning-colored banner sits above the feed filter:
- "N approvals need attention" with arrow
- Click navigates to the approvals detail page
- Returns `null` when `pendingCount === 0`

### 2. Approvals detail page

Full-page view with:
- Back arrow → returns to feed
- Pending approvals section (with `FeedApprovalCard`)
- Expired approvals section (with "Expired" section label)
- Empty state when all approvals are dismissed/resolved
- Allow/Deny actions hit MSW mutation handlers that return `{ ok: true }`
- `resolvedLabel` state tracks which approvals have been acted on
- Uses `clockOf()` for times (e.g. "2:47 PM"), not relative time

### 3. Date-bucketed feed

Feed items are grouped into sequential date sections:
- **Today** / **Yesterday** / **Last 7 days** / **Last 30 days** / **Older**
- Boundaries use local midnight (`setHours(0,0,0,0)`), not 24-hour subtraction
- Section headers use `SectionLabel` component
- Card times show clock format via `clockOf()` (e.g. "3:12 PM")

### 4. Collapsed schedule groups

Within each date bucket, schedule runs are grouped:
- 2+ runs sharing the same `scheduleId` collapse into a `ScheduleGroupCard`
- Shows: title, "N runs · latest Xm ago"
- 1 run with a `scheduleId` renders as a plain `FeedCard` (not grouped)
- Groups appear in feed position of their first item

### 5. Two-facet checkbox filter

Dropdown filter with three sections:
- **All**: master toggle (checks/unchecks everything)
- **State**: `In progress`, `Unread`
- **Where it came from**: `Chats`, `Experiments`, `Scheduled`, `Channels`, `Terminal`

Trigger shows "All" or "X of Y".

### 6. Empty states

Six reachable empty states:
1. **All states excluded** → "Nothing included" / tone: filtered
2. **All categories excluded** → "Nothing included" / tone: filtered
3. **Filter excludes match but not all** → No items, same filtered state
4. **No running agents** → "Nothing running" / tone: clear
5. **Unreadable agents** → "Some agents did not answer" / tone: filtered
6. **All clear** → "All clear — you're all caught up" / tone: clear

---

## Design decisions made in this prototype

### Filter semantics: AND across facets

The filter uses **AND** across facets, **OR** within each facet.

Example: ticking `Unread` (state) + `Scheduled` (category) shows items that are both unread AND came from a schedule. It does NOT show all unread items plus all scheduled items.

This was a noted open question in the design brief: *"Whether ticking Unread and Scheduled means OR or AND across the two facets is undecided."* This prototype implements AND. If OR is preferred, change `filterFeed()` in [feed-filter.ts](src/modules/home/lib/feed-filter.ts) to use `||` instead of `&&` between the two `matches*` checks.

### Approvals removed from chronological feed

Approvals no longer appear as cards in the main feed. They live exclusively in:
1. The pinned summary row (count badge)
2. The approvals detail page (full cards with actions)
3. The floating pill (when not on home view)

The `FeedItem` union type no longer includes an `approval` variant. `toFeedItems()` takes sessions only.

### Clock times instead of relative times

Feed cards and approval cards use `clockOf()` (e.g. "2:47 PM") instead of `timeAgo()` (e.g. "4 min ago"). The schedule group card still uses `timeAgo` for its "latest Xm ago" line since that gives better at-a-glance recency context for grouped runs.

---

## What's NOT in scope

- **No tabs per kind** — the design brief explicitly prohibits this
- **Activity as a record vs. live queue** — not decided, not ours to decide
- **Sessions sidebar** — not refactored to share the new filter control
- **FeedCard interior** — rendered exactly as it ships; no string or icon changes
- **Real backend** — no api-server, no database, no Keycloak, no real tenant
- **Brand hardcoding** — all user-visible brand text flows through `getBrand()`

---

## Mock data cast (§4)

### Agents (3)
| ID | Name | State |
|---|---|---|
| `codingagent-1` | docs-reviewer | running |
| `codingagent-2` | metrics-helper | running |
| `codingagent-3` | release-notes | running |

### Sessions (16)
| Bucket | Session | Agent | Type |
|---|---|---|---|
| Today | 7× sched-linkcheck runs | docs-reviewer | ScheduleCron |
| Today | "Q3 metrics" chat (4m ago) | metrics-helper | Regular |
| Today | "Fix flaky test" chat (47m, RUNNING) | docs-reviewer | Regular |
| Today | "Old quickstart?" slack (33m) | docs-reviewer | ChannelSlack |
| Today | prompt-sweep run 12 (72m) | release-notes | ExperimentExecute |
| Yesterday | "Draft release note" chat | release-notes | Regular |
| Yesterday | "Old CLI flag?" slack | docs-reviewer | ChannelSlack |
| Last 7 days | prompt-sweep run 9 | release-notes | ExperimentExecute |
| Last 7 days | "Error copy" chat | metrics-helper | Regular |
| Last 30 days | 1× weekly-digest run (plain card) | release-notes | ScheduleCron |

The 7 linkcheck runs share `scheduleId: "sched-linkcheck"` → grouped into one `ScheduleGroupCard`.
The 1 weekly-digest run has `scheduleId: "sched-weekly-digest"` → renders as a plain card (not grouped, < 2 runs).

### Approvals (3)
| ID | Status | Type | Agent | Detail |
|---|---|---|---|---|
| `appr-net-1` | pending | ext_authz | docs-reviewer | POST api.github.com |
| `appr-cmd-1` | pending | acp_native | metrics-helper | Bash: pip install |
| `appr-net-2` | expired | ext_authz | release-notes | GET huggingface.co |

---

## File index

### Mock data layer
| File | Status |
|---|---|
| `src/mock/data/agents.ts` | Rewritten |
| `src/mock/data/sessions.ts` | New |
| `src/mock/data/approvals.ts` | Rewritten |
| `src/mock/data/schedules.ts` | Rewritten |
| `src/mock/data/experiments.ts` | Rewritten |
| `src/mock/handlers.ts` | Modified (approval mutations) |

### Infrastructure
| File | Status |
|---|---|
| `vite.config.ts` | Modified (proxy disabled in mock mode) |
| `src/modules/sessions/api/acp-session-ops.ts` | Modified (VITE_MOCK guard) |

### Lib / logic
| File | Status |
|---|---|
| `src/lib/format-time.ts` | Modified (added `clockOf`) |
| `src/modules/home/lib/feed-buckets.ts` | New |
| `src/modules/home/lib/feed-item.ts` | Modified (removed approval variant) |
| `src/modules/home/lib/feed-filter.ts` | Rewritten (two-facet model) |
| `src/modules/home/lib/schedule-groups.ts` | New |
| `src/modules/home/lib/dismissals.ts` | Modified (`approvalDismissalKey`) |
| `src/modules/home/store.ts` | Modified (`dismissByKey`) |

### Components
| File | Status |
|---|---|
| `src/modules/home/components/approval-summary-row.tsx` | New |
| `src/modules/home/components/approvals-detail-page.tsx` | New |
| `src/modules/home/components/schedule-group-card.tsx` | New |
| `src/modules/home/components/feed-filter-bar.tsx` | Rewritten |
| `src/modules/home/components/feed-list.tsx` | Rewritten |
| `src/modules/home/api/queries.ts` | Modified (approvals separated) |
| `src/modules/home/views/home-view.tsx` | Rewritten |
| `src/components/floating-approvals-pill.tsx` | Rewritten |

### Tests
| File | Status |
|---|---|
| `src/__tests__/unit/home-feed.test.ts` | Rewritten (19 tests) |

---

## How to verify

Open `localhost:5175` with `VITE_MOCK=true`. Walk these 7 behaviors:

1. **Pinned approval summary** — Yellow banner above filter says "2 approvals need attention". Click it.
2. **Approvals detail page** — Shows 2 pending + 1 expired. Back arrow visible.
3. **Allow/Deny** — Click Allow or Deny on a pending approval. Card shows resolved label.
4. **Back navigation** — Click back arrow. Returns to feed with date sections.
5. **Feed with date sections** — "Today" section shows: schedule group card (7 runs), plus 4 individual cards. "Yesterday", "Last 7 days", "Last 30 days" sections visible with their items.
6. **Filter** — Click "All" trigger. Uncheck "Scheduled" → schedule group card disappears. Check only "In progress" → only the running session shows. Toggle All off → "Nothing included" empty state.
7. **Empty states** — Reachable by toggling filters (all off, categories off) and by dismissing all items.
