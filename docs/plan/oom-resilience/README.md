# OOM resilience for agent harnesses

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** none filed (sandbox tooling cannot create issues) — problem statement lives in the PR body.

## Goal

When a harness (or its spawned tool processes) exhausts the agent pod's memory limit, the
whole container is OOM-killed today: the pod restarts, the in-flight turn vanishes, and from
the user's point of view the agent silently stops mid-task. Two layers fix this:

1. **Prevention** — agent-runtime kills the largest expendable descendant process *before*
   the kernel OOM-kills the whole container, so the harness survives and the agent sees a
   killed tool call instead of dying.
2. **Recovery** — a turn that still dies mid-flight (harness-as-hog, evictions, any abnormal
   pod death) is durably marked; after the restart, machine-driven sessions auto-resume with
   an injected interruption notice, and interactive sessions surface the interruption to the
   user in the session view.

## Approach

Everything lives in-pod (agent-runtime) plus one shared-schema addition and one UI surface.
No controller or Helm-template changes: the reaper is env-configurable through the existing
chart-level `templateDefaults.env` rail, and recovery keys on a PVC document rather than the
controller's restart counter (which the VM backend never reports anyway).

Architecture pages that govern this work: [agent-lifecycle](../../architecture/agent-lifecycle.md)
(session inside the pod, prompt delivery, the no-auto-resend doctrine) and
[persistence](../../architecture/persistence.md) (the `.platform/` document substrate).
Both pages need updates as part of the final slice-work (see sub-issues).

Key existing seams (all verified in code):

- `packages/agent-runtime/src/server.ts:626-681` — the log-only cgroup/event-loop monitor
  (reads `memory.max` / `memory.current`, warns at ≥85%). Slice 01 turns this into an actor.
- `packages/agent-runtime/src/modules/acp/services/acp-runtime/prompt-scheduler.ts` — already
  exposes `onTurnStarted(submission)` / `onTurnEnded(sessionId)` deps (wired in
  `acp-runtime.ts:142-173` for run accounting). Slice 02 rides the same hooks.
- `packages/agent-runtime/src/core/document-store.ts` — atomic-write `.platform/*.json`
  documents; `session-metadata-store.ts` / `undelivered-prompt-store.ts` are the patterns.
- `packages/agent-runtime/src/modules/acp/services/trigger-session-driver.ts` — in-process
  ACP caller doing `session/resume` + prompt; slice 03 reuses it verbatim for auto-resume.
- `packages/agent-runtime/src/modules/acp/services/acp-runtime/session-bootstrap.ts:105-182`
  (`withReplayMeta` / `respondFromLog`) — where `_meta.platform.turn` is built on
  `session/load`; slice 03 adds `interruptedAt` there.
- `packages/api-server-api/src/modules/acp/types.ts:40-45` — `platformReplayTurnMetaSchema`,
  the shared contract for that meta.
- `packages/ui/src/modules/acp/session-projection.ts` — turns replay + meta into bubbles;
  the undelivered-prompt notice (`undelivered-notice.tsx`) is the UI pattern to mirror.

### Contract pinned across slices

- **Marker document** `.platform/active-turns.json`:
  `{ sessions: { [sessionId]: { startedAt: string, origin: "machine" | "interactive", attempts: number } } }`.
  `origin` is `"machine"` when the session's platform meta marks it schedule-driven (same
  predicate `acp-runtime.ts` already uses for `startRun`: `meta.type === SessionType.ScheduleCron || meta.scheduleId`),
  else `"interactive"`.
- **Lifecycle**: written on turn start, cleared when the turn *completes* (`onPromptResponse`
  path), NOT cleared when the scheduler drops turns (`clear()`/`forget()` on harness death) —
  a harness crash is an interruption too. Cleared on session delete and on graceful shutdown
  (SIGTERM = hibernation/hard stop; auto-resuming deliberately stopped work is wrong).
  A leftover marker at boot ⇒ that turn was interrupted by an abnormal death.
- **Turn meta extension**: `platformReplayTurnMetaSchema` gains `interruptedAt: z.string().optional()`,
  reported on `session/load` while an unresolved interactive marker exists.
- **Recovery rule**: at boot, for each leftover marker — `origin === "machine"` and
  `attempts === 0` → bump `attempts`, then `triggerDriver.start({ task: <notice>, resumeSessionId })`;
  otherwise keep the marker for surfacing. One attempt ever, so a continuation that OOMs
  again cannot crash-loop.
- **Notice text** (module-level const, slice 03):
  `<turn-interrupted>` block telling the agent its previous turn was cut short by an
  unexpected pod restart (likely out of memory), that side effects of its last actions may be
  partial, and to review workspace state and continue the task.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Early-OOM reaper in agent-runtime | Kill the largest non-protected descendant at a memory threshold | — |
| 02 | Durable active-turn markers | `.platform/active-turns.json` written/cleared around turns | — |
| 03 | Boot-time recovery + interrupted turn meta | Auto-resume machine sessions with notice; expose `interruptedAt` on load | 02 |
| 04 | UI notice for interrupted sessions | Render the interruption in the session view | 03 |

## Conventions & glossary

- Apply `/typescript-engineering` for all agent-runtime / api-server-api work, and
  `/react-ui-engineering` for slice 04.
- Comment rules: `docs/guidelines/comment-guidelines.md`; run
  `mise run common:check:comment-types` after changes.
- **Marker** — one entry in the active-turns document. **Machine session** — schedule-driven
  session per the predicate above. **Reaper** — the early-OOM watchdog in agent-runtime.

## Whole-feature smoke test

On the local cluster (`cluster-ops` skill):

1. Create a claude-code agent with the default 2Gi Size; in a chat session, ask the agent to
   run a memory-hog command (e.g. `node -e 'const a=[];for(;;)a.push(Buffer.alloc(64e6))'`).
   Expect: pod log shows `[mem-reaper] killed …`, the tool call fails inside the turn, the
   harness and pod stay up, the turn completes.
2. Disable the reaper (`MEM_REAPER=off` in the agent's Environment), repeat: pod is
   OOM-killed and restarts; reattach the session — the UI shows the interruption notice.
3. Interrupt a scheduled (continuous) session the same way: after the pod restarts, the
   session auto-resumes and the transcript shows the injected interruption prompt and the
   agent continuing.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR.
