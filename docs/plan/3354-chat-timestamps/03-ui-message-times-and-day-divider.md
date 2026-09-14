# 03 — The chat shows each message's time, and the day divider

**Depends on:** 01-runtime-stamps-live-frames (contract); richer with 02 in place
**Part of:** Chat timestamps — see [README](./README.md)

## Context

The UI reads `params._meta.platform.at` off every incoming frame, carries it through the session
projection onto `Message.at`, and renders it: a relative time beside the role label, the absolute
day-qualified time on hover, and a day divider wherever the thread crosses midnight. A message with
no `at` renders nothing in the time slot — no placeholder. This slice also lays down the pure
`threadItems` derive that slice 04 extends with run dividers, so its signature already accepts
`runStarts`. Apply `/react-ui-engineering`; the projection and derive are pure TypeScript, so
`/typescript-engineering` conventions hold there.

## Implementation plan

1. **Model** — `packages/ui/src/types.ts`: add `at?: string` to `Message` (ISO string, absent when
   unknown).
2. **Frame metadata reaches the handler** —
   - `packages/ui/src/modules/acp/types.ts`: add `export interface FrameMeta { replayFor?: string;
     at?: string }` and change `UpdateHandler` to `(update, sessionId, frame?: FrameMeta) => void`.
   - `packages/ui/src/modules/acp/ext-notifications.ts`: replace `replayForOf(meta)` with
     `frameMetaOf(meta): FrameMeta`. **Parse the two fields independently** — a malformed `at`
     must never cost the frame its `replayFor`, or replayed frames would leak into the live
     handler. Keep the existing string check for `replayFor`; for `at`, accept a string that
     `platformFrameMetaSchema.shape.at` parses (or, equivalently, whose `Date.parse` is finite) and
     drop it otherwise. `RoutedExtUpdate.replayFor` becomes `frame`.
   - `packages/ui/src/modules/acp/acp.ts`: `sessionUpdate` calls
     `onUpdate(params.update, params.sessionId, frameMetaOf(params._meta))`; `extNotification`
     passes `routed.frame`.
   - `packages/ui/src/modules/sessions/hooks/use-acp-connection.ts`: the two handler wrappers
     (around lines 191 and 270) take `frame` instead of `replayFor`; the collector test becomes
     `frame?.replayFor === collector.token`; the live path passes `frame` on to the handler. Every
     `applyUpdate` call in this file — the collector replay included — passes `frame?.at`.
   - `packages/ui/src/modules/sessions/hooks/use-acp-update-handler.ts`: the returned handler has
     the new signature and calls `applyUpdate(prev, update, frame?.at)`.
3. **Projection** — `packages/ui/src/modules/acp/session-projection.ts`:
   `applyUpdate(messages, update, at?: string)`. Rules from the README:
   - `user_message_chunk` → `appendOrExtendUser`: set `at` when the user message is **created**;
     never overwrite on later chunks.
   - `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update` →
     `appendToActive` / `handleToolCall*`: set `at` on creation and **update** it on every chunk
     that carries one (latest wins).
   - `platform_turn_ended` → `closeActiveAssistant(messages, at)`: set the closed assistant's `at`
     when provided.
   - Notices and `platform_clipped_replay` get no `at`. `platform_prompt_*` ignore it.
4. **Formatting** — `packages/ui/src/lib/format-time.ts`: add `sameLocalDay(a, b)`,
   `dayLabel(value, now = new Date())` and `clockLabel(value)` per the README's Labels convention
   (`toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })` for the
   same-year form, add `year: "numeric"` otherwise; `toLocaleTimeString(undefined, { hour:
   "numeric", minute: "2-digit" })` for the clock). Reuse `timeAgo` unchanged.
5. **Derive** — new `packages/ui/src/modules/sessions/lib/thread-items.ts`, pure:
   ```ts
   type ThreadItem =
     | { kind: "message"; message: Message; index: number }
     | { kind: "divider"; variant: "day" | "run"; at: string; key: string };
   export function threadItems(messages: readonly Message[], runStarts: readonly string[], now?: Date): ThreadItem[];
   ```
   `index` is the message's position in `messages`, so the caller's `isLast` stays exact. In this
   slice implement the **day** rules only and ignore `runStarts` (slice 04 fills it in): walk the
   messages; untimed ones pass through; between consecutive timed messages whose `at` fall on
   different local calendar days, emit a `day` divider labelled for the later message; if the thread
   spans more than one day, also emit one before the first timed message. Keys must be stable
   (`day:<yyyy-mm-dd>`).
6. **Divider component** — new `packages/ui/src/modules/sessions/components/thread-divider.tsx`:
   `<ThreadDivider label />` — one flex row, `text-[11px] text-muted-foreground`, a hairline
   (`border-t border-border/60`) on each side of the centered label. Same tone as the existing
   notice span in `chat-message.tsx`; no card, no fill.
7. **Message label** — `packages/ui/src/modules/sessions/components/chat-message.tsx`: add a
   `now: Date` prop. Turn the role label into one `flex items-baseline gap-1.5` row: the existing
   `Agent`/`You` span, then — only when `message.at` is set —
   `<Tooltip side="top" content={`${dayLabel(message.at, now)} ${clockLabel(message.at)}`}>` around
   a `text-[11px] text-muted-foreground` span reading `timeAgo(message.at, now)`. When `at` is
   absent, render nothing there. `Tooltip` is `packages/ui/src/components/ui/tooltip.tsx`
   (`content`, `side`, children).
8. **Thread** — `packages/ui/src/modules/sessions/views/chat-view.tsx`: `const now =
   useNow(60_000)` (`packages/ui/src/hooks/use-now.ts`, already used this way in
   `home/components/feed-list.tsx`). Replace the `messages.map(...)` block (around line 703) with
   `threadItems(messages, [], now).map(...)`: dividers render `<ThreadDivider>` with the label for
   their variant; messages render `<ChatMessage … now={now} isLast={item.index === messages.length
   - 1}>`. `ChatMessage` is memoised, so the once-a-minute `now` change re-renders each message once
   a minute; that is intended and cheap.
9. **Existing tests to update, none to add** —
   `packages/ui/src/__tests__/unit/session-projection.test.ts` (new optional third argument;
   assert `at` where a fixture passes one), `acp-ext-notification-routing.test.ts` (`replayFor` →
   `frame`). `format-time.test.ts` is untouched unless it enumerates exports.
10. `mise run check:comment-types`. The derive's rules are documented in the README; keep any
    in-code comment to a one-line `/** */` on `threadItems` at most.

## Acceptance criteria

- [ ] With a fixture of frames carrying `at`, `applyUpdate` yields: user `at` = first chunk's,
      assistant `at` = latest chunk's, then the `platform_turn_ended` time once it arrives; a frame
      without `at` leaves the message's `at` unchanged.
- [ ] `threadItems` on a single-day thread emits no dividers; on a thread spanning two days it
      emits a `day` divider before the first timed message and one at the day change; untimed
      messages never trigger or receive a divider; `index` matches each message's position.
- [ ] `dayLabel` returns `Today` / `Yesterday` for those days, the weekday-month-day form for the
      same year, and includes the year otherwise; `clockLabel` returns the locale short time.
- [ ] In the chat, a message with `at` shows the relative time beside its role label, and hovering
      shows the day-qualified absolute time; a message without `at` shows only the role label.
- [ ] The relative labels advance without user interaction (`just now` → `1m ago`).
- [ ] The `Older conversation not loaded` / load-older markers render as before.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test` pass with existing tests
      updated, none added; `mise run check:comment-types` passes.

## Smoke test

```bash
mise run //packages/ui:check && mise run //packages/ui:test && mise run check:comment-types
```

Then on the dev cluster: `mise run cluster:build-ui` (slices 01 and 02 already deployed via
`cluster:build-agent`; hard-reload if the bundle looks stale). Open a Claude Code agent at
`http://localhost:4444` and send a prompt: `You just now` appears beside the prompt, the agent's
label reads `just now` while streaming and settles when the turn ends; hover either to see
`Today <clock>`. Wait a minute: both read `1m ago`. Reopen the thread after closing the tab: the
times remain (slice 02). Open a thread from a `bob` or `pi-agent` agent: while watching, times
appear; after a reopen, role labels stand alone with nothing beside them. To see the day divider
without waiting for midnight, open a Claude Code thread that has messages from a previous day.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
