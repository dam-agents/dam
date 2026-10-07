# 07 — Chat UI bug bash on both Backends

**Depends on:** 01–06
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

This feature rewires how the chat holds user messages, queued prompts, steered prompts and reply
placeholders, and the chat already has visible bugs in that area (for example a reply's working
dots left above a later user message, and a queued placeholder that reads as an agent reply). The
last slice exercises the whole chat by hand, reproduces each bug, fixes the ones in message
handling, and files the rest. It runs **mainly on the vm Backend** — `virtualization.enabled=true`
with the sandbox runtime experiment on — because that is where agents are headed, and also on
the container Backend.

## Implementation plan

Apply `/react-ui-engineering` (UI) and `/typescript-engineering` (runtime) for fixes; use the
`cluster-ops` skill for the environment.

1. **Environment.** Install with `--set=virtualization.enabled=true`; on a Mac run
   `mise run cluster:host-runner` ([vm-host-runner](../../architecture/vm-host-runner.md)).
   Confirm how a rebuilt agent image reaches a vm machine (runner image cache,
   [vm-image-cache](../../architecture/vm-image-cache.md)) and that the machine runs **this
   branch's** runtime before testing: the queue broadcast from 01 is the tell — a queued message
   shows as a user "Queued" bubble, never as an agent "Waiting for previous prompt…" bubble.
   Turn the sandbox runtime experiment on for the test user; create one Claude Code agent and
   one Codex (or Bob) agent on vm, and the same pair on container.
2. **Scenario list** — run each on every agent, in one tab and in two tabs, and after a reload:
   - send, reply streams, send again (no queue);
   - send mid-turn: steered (Claude Code, pi) or queued (Codex/Bob); several in a row;
   - edit and delete a queued message; edit as it starts;
   - Stop mid-turn with and without a queue;
   - rewrite from an earlier message (04);
   - drop the network for a few seconds mid-turn and mid-queue; hibernate and wake mid-session;
   - a permission prompt while messages are queued;
   - long reply, scroll up, load older messages while a turn streams;
   - new session focus, switch sessions mid-turn, delete another session (#4239 if still open).
3. **Bug log.** Record each defect with steps, Backend, harness, and a screenshot in a scratch
   list. For each: fix it here when it is in message handling (projection, prompt delivery,
   queue, steering, chat rendering) and small; otherwise draft an issue for the user to file.
   Ask the user before a fix that changes behavior beyond the bug.
4. **Fixes** follow the usual rules: one commit for this slice, existing tests green, no new
   tests unless the user asks.

## Acceptance criteria

- [ ] Every scenario passes on vm Claude Code and vm Codex/Bob, or has a fix in this slice, or a
      drafted issue the user approved to defer.
- [ ] The screenshot bug (working dots stranded above a later user message, agent-styled
      "Waiting for previous prompt…") does not reproduce.
- [ ] Container Backend spot check: steer, queue, edit, Stop, rewrite pass.
- [ ] `mise run //packages/ui:test` and `//packages/agent-runtime:test` pass.

## Smoke test

The scenario list in step 2 is the smoke test; the user runs it with the implementing agent,
vm Backend first.
