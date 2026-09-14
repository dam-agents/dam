# Chat timestamps — when each message was posted, with day and run dividers

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3354
**Design:** [3354-chat-timestamps-board.pdf](https://github.com/user-attachments/files/31427620/3354-chat-timestamps-board.3.pdf) (4 flows, 6 screens, attached to the issue by the designer)

## Goal

A user reading any chat thread can tell when each message was posted, and can see at a glance
where a long-running or scheduled session breaks into separate stretches of activity.

Concretely, on screen:

- A **relative time** beside each role label — `You 12m ago`, `Agent just now`. Hovering it shows
  the absolute, day-qualified time — `Today 2:18PM`.
- A **day divider** — a centered hairline rule reading `Yesterday`, `Today`, … — wherever the thread
  crosses midnight.
- A **run divider** in a schedule's thread — `Yesterday 9AM · Scheduled run` — at the start of
  each scheduled run.

The issue's third story ("how long did that take") is served by the two adjacent times; the design
has no separate duration element and this plan adds none.

**One deliberate departure from the design board.** Flow 4 labels messages with no known time as
`time not recorded`. The product owner dropped that label: **when a message has no time, render
nothing in its place.** Dividers likewise appear only where the times to place them exist. The
"Older conversation not loaded" marker in that flow already ships and is untouched.

## Approach

Read every time from where it already exists; store nothing new except the start time of each
scheduled run. Three mechanisms, none of them new:

1. **Live frames are stamped by the runtime.** Every frame the agent-runtime appends to a session
   log while a turn happens gets the wall-clock time in the platform metadata slot,
   `params._meta.platform.at`. This is harness-agnostic — the platform does the stamping — and it
   rides the channel `replayFor` already proves end to end: the runtime writes it, the api-server
   relays frames as raw bytes, and the UI reads `params._meta` on every `sessionUpdate`.
2. **Replayed history carries the harness's own time.** After the last viewer leaves, the runtime
   discards the in-memory log within seconds ([agent-lifecycle](../../architecture/agent-lifecycle.md#session-inside-the-pod)),
   so a reopened thread is rebuilt from the harness's store. For Claude Code that goes through the
   image's declared session-history reader, and Claude Code stamps every stored message. The
   reader copies that stamp onto the frames it builds. Frames that arrive through the other
   rebuild route — the harness's own `session/load` replay — carry no time, and **the runtime never
   invents one for a replayed frame.**
3. **Scheduled runs are placed by time.** The runtime already records the start of every scheduled
   run to count runs and total their duration ([persistence](../../architecture/persistence.md) —
   the session-metadata state file). The list of start times is kept beside that count and handed
   to the UI with the session load. Once messages carry times, a run divider needs no match to a
   message: it sits at the moment the run started.

The session log stays exactly what [agent-lifecycle](../../architecture/agent-lifecycle.md)
describes — an in-memory cache, not a source of truth. Nothing about persistence, replay order, or
the session-history reader's contract changes. This scope was agreed with the log's author after a
heavier design (a durable platform-owned transcript) was judged not worth its weight.

**What this delivers, by harness.** Claude Code: all three stories, live and after reopen — and
because Claude Code has always stamped its store, existing threads show times the day this ships
(run dividers start from the first fire after it). `bob`, `pi-agent`, `codex` (no history reader):
times and dividers while a viewer watches; nothing after a reopen. That asymmetry is accepted.

Architecture pages touched: none need a content change. `agent-lifecycle.md` §Session inside the
pod may gain one sentence naming `_meta.platform.at`; do that in slice 01, not separately.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ✅ Runtime stamps live frames with their time | Contract field; `session-transcript` stamps `append`/`appendEcho`, never `appendReplay` | — |
| 02 | ✅ The Claude Code history reader passes its times through | `harness-history-lib.mjs` copies each stored message's timestamp onto the frames it emits | 01 |
| 03 | ✅ The chat shows each message's time, and the day divider | `Message.at` through the projection; relative label + hover; `threadItems` derive with day dividers | 01 |
| 04 | ✅ The run divider for scheduled runs | Runtime keeps run start times and surfaces them (load response + live notification); UI places run dividers | 03 |

01 → 02 → 03 → 04 is a fine linear order. 02 is image-side and verifiable on its own; 03 is fully
visible once 01 is in (live turns) and richer once 02 is in (reopened threads).

## Conventions & glossary

- **Frame** — one JSON-RPC line in a session log (`session/update` or a `platform/*` notification).
- **`at`** — the frame's time, ISO 8601 with offset (`new Date().toISOString()`), at
  `params._meta.platform.at`. Optional everywhere. Absent means unknown; never guessed.
- **Live frame** — appended via `transcript.append` / `appendEcho` while a turn happens. Stamped.
- **Replayed frame** — appended via `transcript.appendReplay` while a log is being (re)filled from
  a history reader or the harness's own `session/load`. Never stamped by the runtime; carries
  whatever `at` its source already put there.
- **Run start** — the moment `sessionMetadata.startRun(sessionId)` fires: a non-viewer channel
  starting a turn on a machine session (`type === ScheduleCron || scheduleId`). Exactly one per
  scheduled fire; never a human reply.
- **Message time rules (UI).** A user message's `at` is its first chunk's `at`. The client that
  *sends* a message never receives its own echo (`appendEcho` skips the originator), so it stamps
  its optimistic bubble with the local clock at send time; the runtime's own stamp replaces it on
  the next reload. An assistant
  message's `at` is the latest `at` seen among its chunks and its `platform_turn_ended`, so once
  a turn ends the assistant time is when the answer finished and `assistant.at − user.at` reads as
  the turn's duration. Notices (`message.notice`) have no `at`.
- **Divider rules (UI).** Run dividers win: at any gap where a run divider is placed, no day
  divider is placed. Day dividers appear only when the thread spans more than one local calendar
  day; when they do, the first timed message also gets one (design flow 2), unless a run divider
  already precedes it. Untimed messages are transparent to both rules.
- **Run divider placement.** A run start `T` is recorded when the turn *starts*; the run's prompt
  echo is appended at *acceptance*, a few milliseconds earlier. So "before the first message with
  `at ≥ T`" would drop the divider between the prompt and its answer. The rule is instead: place
  the divider immediately before the newest message with `at ≤ T`, **and only when that message is
  a user message** — the echo is appended milliseconds before the run starts, so at time `T` the
  run's own prompt is the newest thing in the thread. That bound matters: without it a fire whose
  echo has not landed yet would anchor to the *previous* run's prompt, since that is still a user
  message with `at ≤ T`. When the newest such message is not a user message, place the divider
  before the first message with `at ≥ T`; if none, at the end of the thread (the run has begun, its
  echo is pending).
  Run starts are deduplicated by ISO string and sorted ascending before placement.
- **Labels.** `dayLabel(d, now)` → `Today` | `Yesterday` | `Wednesday, Aug 19` (same year) |
  `Aug 19, 2025` (other year). `clockLabel(d)` → locale short time (`2:18PM`). Hover = `dayLabel +
  " " + clockLabel`. Run divider = `dayLabel + " " + clockLabel + " · Scheduled run"`. Relative
  label = existing `timeAgo` (`just now`, `12m ago`, `1d ago`).
- **No new tests by default.** Verification leans on the existing suites (`mise run
  //packages/<pkg>:test`, `:check`) plus the manual smoke test. Existing tests that pin exact
  frame strings or `applyUpdate`'s signature are *updated*, not multiplied.
- **Skills:** apply `/typescript-engineering` in `packages/agent-runtime`, `packages/api-server-api`
  and the `.mjs` in `packages/agents`; apply `/react-ui-engineering` in `packages/ui`. Run
  `mise run check:comment-types` after every code change; typed comments need a `/** */` block.
- **Contract lives in `packages/api-server-api/src/modules/acp/types.ts`** beside the existing
  `platform*` schemas; noun-first names.

### Pinned contract (both sides implement against this)

```ts
// packages/api-server-api/src/modules/acp/types.ts

/** Per-frame platform metadata at params._meta.platform on any session/update or platform/* frame. */
export const platformFrameMetaSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  replayFor: z.string().min(1).optional(),
});
export type PlatformFrameMeta = z.infer<typeof platformFrameMetaSchema>;

/** Load-response _meta.platform.runStarts: ISO times of every scheduled run start this session has served. */
export const platformRunStartsMetaSchema = z.array(z.string().datetime({ offset: true }));

/** Live, unlogged notification to engaged viewers when a scheduled run starts. */
export const platformRunStartedParamsSchema = z.object({
  sessionId: z.string().min(1),
  at: z.string().datetime({ offset: true }),
});
export const platformRunStartedNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("platform/runStarted"),
  params: platformRunStartedParamsSchema,
});
export function buildPlatformRunStartedNotification(params: PlatformRunStartedParams): PlatformRunStartedNotification;
```

Slice 01 adds `platformFrameMetaSchema`; slice 04 adds the two `runStart*` shapes. Both export
from `packages/api-server-api/src/index.ts`.

## Whole-feature smoke test

On the local dev cluster (see the `cluster-ops` skill; the app is `http://localhost:4444`):

1. `mise run cluster:build-agent` (rebuilds the claude-code image; needs Rancher Desktop running),
   `mise run cluster:build-apiserver`, `mise run cluster:build-ui`. If the UI looks stale afterwards,
   hard-reload — see the service-worker note in memory.
2. Open a Claude Code agent. Send two prompts a minute apart. Each message shows `You <n>m ago` /
   `Agent <n>m ago`; hovering shows `Today <clock>`. The assistant label updates to when the answer
   finished. No divider appears (single day).
3. Close the tab, wait 10 s, reopen the same thread. Times are still there (came through the
   history reader, slice 02). Open a thread from **before** this change: it shows times too.
4. Create a **continuous** schedule with a one-minute cron on that agent. Let it fire twice. The
   thread shows `Today <clock> · Scheduled run` above each run's prompt. Reopen: dividers persist.
   Watch it live while a third fire lands: the divider appears without a reload.
5. Open a thread on a `bob` or `pi-agent` agent. While watching, times appear; reopen it: labels and
   dividers are simply absent — no placeholder text anywhere.
6. Sanity: `mise run check` and `mise run test` green.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3354.
