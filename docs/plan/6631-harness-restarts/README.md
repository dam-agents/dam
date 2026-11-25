# Harness restarts lose Pi spend and break Bob and Codex sessions

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6631

## Goal

A harness process that stops or starts must not break the sessions it serves.
Today three things go wrong:

- **Pi:** when Pi's process stops before a session's first message, the session's model calls count under "No session" from then on.
- **Bob:** Bob refuses the first request after each start of its process, with `ACP connection must be initialized before 'session/new'` (or `'session/load'`).
- **Codex:** when Codex's `codex` process stops, every Codex session on the agent fails with `Codex process has exited with code 0` until the harness restarts.

After this feature, a Pi session keeps its own id through such a restart, so its spend stays on it.
Bob answers the first request after it starts.
Codex works again on the next message after its `codex` process stops.

## Approach

The harness processes and their leases are described in [Sessions → Session inside the machine](../../architecture/sessions.md#session-inside-the-machine).
How the Model Router books a call to a session from what each harness stamps is in [harness configuration](../../architecture/harness-config.md) (the paragraph that starts "The session is read from what each harness stamps").
Unstored sessions, those a harness has not written yet, are described in the same Sessions page.

The three failures have one trigger and three fix sites:

1. **Pi (pi-acp patch).**
   pi-acp gives each session its own Pi process and stores the path of Pi's session file at `session/new`.
   Pi writes that file only when the session's first message arrives.
   When the process stops before that, pi-acp starts Pi again with `--session <stored path>`; Pi finds no file there and makes a new session with a new id.
   The `pi-dynamic-providers` extension stamps every model call with Pi's current id (`x-platform-session`), so the platform cannot book the calls to the session.
   The fix: when the stored file does not exist, pi-acp starts Pi with `--session-id <platform session id>`.
   Pi 1.5.1, the version the image pins, then opens the session whose header has that id, or makes a new session with that id.
2. **Bob (agent-runtime).**
   Bob refuses every request except `initialize` until it has written its `initialize` answer.
   agent-runtime forwards the first `initialize` of a new harness process and sends the next client frame right behind it, without waiting for the answer.
   The fix: agent-runtime sends nothing else to a new harness process until it has answered that `initialize`.
   This applies to every harness, not only Bob.
3. **Codex (codex-acp patch).**
   codex-acp 2.1.1 spawns one `codex` process for all sessions.
   When that process exits, codex-acp stays alive and fails every request; it restarts the child only on a provider change that the platform never sends.
   agent-runtime does not see a failure inside a live adapter; it replaces a failed harness only when the adapter process itself exits: the lease router drops the lease, and the next frame for that harness starts a new one.
   The fix: codex-acp exits when its `codex` process exits, so that existing path takes over.

The three fixes are independent.
No client, API or database change is needed.

## Sub-issues

| #     | Title                                                                                                            | Scope                                                        | Depends on |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------- |
| ✅ 01 | [Pi keeps the platform's session id when it restarts before the first message](./01-pi-session-id-on-restart.md) | `pi-acp-patch.mjs`, pi-agent README                          | —          |
| 02    | [The runtime waits for a new harness process to answer `initialize`](./02-wait-for-initialize-answer.md)         | `acp-runtime.ts`, `sessions.md`                              | —          |
| 03    | [codex-acp exits when its `codex` process exits](./03-codex-acp-exits-with-codex.md)                             | `codex-acp-patch.mjs`, codex README, `check/codex-acp-patch` | —          |

The order is a suggestion: 01 first, because it is the bug the issue was opened for.

## Conventions & glossary

- **Disruption:** one of three events before a session's first message: the harness process is killed, the runtime closes the idle session (3 s after its last client disconnects, `idleReapDelayMs`), or the runtime restarts the harness for an env change (for example, a provider grant).
- **Platform session id:** the ACP session id the client got from `session/new`.
  For Pi it is the id that `get_state` reported at `session/new`; the spend rows (`spend_calls.session_id`) and the sidebar use it.
- **The patches:** pi-acp and codex-acp are third-party bundles that the images load through in-memory patches (`pi-acp-patch.mjs`, `codex-acp-patch.mjs`).
  Each patch has a `PATCHED_VERSION`, an `UPSTREAM_GAPS` text, and an `edits` list of exact `find` / `replace` / `count` entries; the patch is skipped as a whole when one edit does not match.
  Each patch has a "… patch" section in its image's README that lists what the edits do and when to remove them.
- **Engineering skills:** apply `/typescript-engineering` to the agent-runtime change (02).
  The patches (01, 03) are plain JavaScript that edits a bundle; follow the existing edits' style.
- **Comments:** follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md), and run `mise run check:comment-types` after each change.
- **Docs:** follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md); one sentence per line (`mise run fix:markdown`).
- **No new tests.** Keep the existing suites green, and change an existing test only where a fix changes what it asserts.
  Prove each slice with its smoke test.

## Whole-feature smoke test

Run it on a dev install of this branch, once all three sub-issues are done (cluster setup: the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill).

The test needs a small throwaway ACP client, which this repository does not keep.
It opens the agent's ACP WebSocket (`/api/agents/<agent id>/acp`, with a dev user's token), sends `initialize`, then `session/new` with `_meta.platform.harness` and `_meta.platform.model`, and logs every answer and every close of the connection.
It can then wait with the connection open, or close the connection, wait, and connect again; then it sends `session/load` and `session/prompt` for the same session.
A prompt that runs one shell command and replies with its output is enough.

Use one agent that carries Pi, Claude Code, Codex and Bob, with a model for each.

1. **Pi, each disruption:** after `session/new`, do one disruption, then load and prompt.
   - Kill: `dam ssh connect <agent> -- 'kill $(pgrep -n -x pi)'`.
   - Idle close: close the connection, wait 10 s, connect again.
   - Env restart: grant the agent a provider, or remove one, within 5 s after `session/new`.

   For each, check that every call of the turn is in `spend_calls` with `session_id` equal to the platform session id, that the session's cost shows in the chat and in `dam metrics`, and that Pi's `/session` command shows the platform session id.
   Then kill Pi again, prompt the same session once more, and check that the reply knows the first turn and that the calls still count under the session.

2. **Bob:** restart Bob three ways (the agent's first boot or a wake, a kill of `bob.js acp`, an env restart) and send `session/new` or `session/load` right after each.
   None is refused with "ACP connection must be initialized".

3. **Codex:** start a Codex session and run one turn.
   Kill the `codex` process (`pgrep -n -x codex`).
   The next prompt to that session works, after the runtime starts the harness again, and the session keeps its history; a new Codex session also works.

4. **Controls and regressions:** for each harness, one normal run with no disruption books every call to its session.
   Claude Code with the three disruptions behaves as before: no call counts under "No session", and a load of the never-stored session fails.

5. Record the commands and results in the PR body.
   Say "a dev install of this branch"; do not name a local cluster.

## Not in scope

- Repair of spend that already counted under "No session", and of sessions whose id already changed.
- The "no model provider" error a client gets when it prompts a session that the runtime removed after a failed load.
  The UI, the CLI, Slack and Telegram load a session before they prompt it, and they handle a failed load.
- A Codex turn that stays running when a client loads a never-prompted session within about 60 s of its idle close.
  Only a raw ACP client meets it, and the cause is not verified.
- Keeping a session with no messages alive while no client is connected.
  Fix 01 already keeps Pi's spend right, and the other harnesses lose no spend.
- A codex-acp version bump: codex-acp 2.2.0 and later restart their `codex` process on their own, but a bump re-ports every edit of the codex-acp patch.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6631.
