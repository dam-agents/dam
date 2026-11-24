# 01 — Pi keeps the platform's session id when it restarts before the first message

**Part of:** Harness restarts lose Pi spend and break Bob and Codex sessions — see [README](./README.md)

## Context

pi-acp starts Pi again with `--session <stored path>` when a session's Pi process is gone, but Pi writes that file only at the session's first message.
After a disruption before that message, the path does not exist, Pi makes a new session with a new id, and every later call of the session counts under "No session".
This slice adds pi-acp patch edits so that pi-acp starts Pi with `--session-id <platform session id>` when the stored file does not exist.

## Implementation plan

1. Read the "pi-acp patch" section of [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md) and the patch, [`packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs): `PATCHED_VERSION` (`0.0.34`), `UPSTREAM_GAPS`, and the `edits` list.
2. Read the pi-acp 0.0.34 bundle the tests use: `node_modules/.pnpm/pi-acp@0.0.34/node_modules/pi-acp/dist/index.js`.
   - `PiRpcProcess.spawn(params)` builds Pi's arguments: `["--mode", "rpc", "--no-themes"]`, then `if (params.sessionPath) args.push("--session", params.sessionPath);`.
   - `restoreSession(sessionId, opts)` is the only spawn that passes `sessionPath` (`sessionPath: stored.sessionFile,`); `loadSession` and the prompt path of an unloaded session both go through it.
   - `newSession` spawns without `sessionPath`, and stores `get_state().sessionFile` with the session id `get_state()` reported.
3. Add edits to the `edits` list, each with an exact `find`, its `replace` and `count: 1`:
   - In `restoreSession`, hand the session id to the spawn next to `sessionPath`.
   - In `PiRpcProcess.spawn`, when the session path does not exist on disk and a session id is given, push `--session-id <id>` in place of `--session <path>`; otherwise keep `--session <path>`.
     Pi refuses `--session` and `--session-id` together.
   - Use the existence check the bundle already imports (`existsSync` under its bundled name), or import it in the patch's helpers; follow how the existing edits reach patch helpers (`HELPERS`).
4. Keep pi-acp's store as it is.
   After a `--session-id` start, Pi writes its file under a new name; a later restart finds the stored path missing again, starts Pi with `--session-id` again, and Pi 1.5.1 opens the file whose header has that id.
   Step 2 of the smoke test proves this; store Pi's new `sessionFile` only if it fails.
5. Add the gap to `UPSTREAM_GAPS` and to the "pi-acp patch" section of the README: what pi-acp does today, what the edit does, and when to drop it (a pi-acp release that restores an unwritten session under its own id).
   Update the count of gaps the README names ("A release that fixes only some of the nine …").
   Update the message in [`packages/agents/.mise/tasks/check/pi-acp-patch`](../../../packages/agents/.mise/tasks/check/pi-acp-patch), which lists what a pi-acp release must fix before an edit is dropped.
6. Read the paragraph of [`docs/architecture/harness-config.md`](../../architecture/harness-config.md) that starts "The session is read from what each harness stamps".
   It says Pi's extension sets `x-platform-session` to the platform's session id; that is true again after this edit, so change it only if its wording no longer matches.

## Acceptance criteria

- [ ] A Pi session whose process was killed before its first message counts every call of its first turn under the platform session id (`spend_calls.session_id`), not "No session".
- [ ] The same holds after an idle close and after an env restart before the first message.
- [ ] Pi's `/session` command shows `Session: <platform session id>` in those cases.
- [ ] A second restart of the same session, after its first turn, keeps the id and the history.
- [ ] A session whose file exists still starts with `--session <path>`; the existing Pi tests pass unchanged.
- [ ] The patch still applies to pi-acp 0.0.34 as a whole: the machine log has no `pi-acp-patch: not applied`.

## Smoke test

1. `mise run //packages/agents:check:pi-acp-patch`, `mise run //packages/agents:test:pi-session-ref`, `mise run //packages/agents:test:pi-replay`: all pass.
   These drive the real pi-acp and the real Pi through the patch.
2. Build the Pi image and install this branch on a dev cluster (`cluster-ops` skill).
   Run step 1 of the README's whole-feature smoke test for Pi: the three disruptions, the spend rows, `/session`, and the second restart.

Then print a short guide for the user to repeat step 2 by hand.
