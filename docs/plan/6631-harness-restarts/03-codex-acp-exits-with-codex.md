# 03 — codex-acp exits when its `codex` process exits

**Part of:** Harness restarts lose Pi spend and break Bob and Codex sessions — see [README](./README.md)

## Context

codex-acp 2.1.1 runs one `codex` process for all Codex sessions of a harness lease.
When that process exits, codex-acp stays alive, and every request of every Codex session fails with `Codex process has exited with code N` until something restarts the harness.
agent-runtime already replaces a harness whose adapter process exits: the lease tears down with `agent-exited`, the lease router drops the lease, and the next frame for Codex starts a new one.
This slice adds a codex-acp patch edit that makes codex-acp exit when its `codex` process exits, so that path takes over.

## Implementation plan

1. Read the "codex-acp patch" section of [`packages/agents/codex/README.md`](../../../packages/agents/codex/README.md) and the patch, [`packages/agents/codex/rootfs/usr/local/share/codex-platform/codex-acp-patch.mjs`](../../../packages/agents/codex/rootfs/usr/local/share/codex-platform/codex-acp-patch.mjs): `PATCHED_VERSION` (`2.1.1`), `UPSTREAM_GAPS`, the doc comment that explains each edit, and the `edits` list.

2. The codex-acp bundle is not in this repository; copy `package.json` and `dist/index.js` of `@agentclientprotocol/codex-acp` 2.1.1 out of a running Codex agent (`dam ssh connect <agent> -- 'cat <path>'`; the package is under `/usr/share/mise/installs/npm-agentclientprotocol-codex-acp/`) into a scratch folder named `codex-acp`, keeping that layout.
   The patch reads the version from `../package.json`, and the patch test finds the bundle by its `/codex-acp/dist/index.js` suffix.
   In it, `observeCodexProcess()` is the one place that reacts to the child's exit:

   ```js
   process11.once("exit", () => {
     if (generation !== this.codexProcessGeneration) return;
     void this.finishAllAsyncTasks("failed", "after the Codex process exited");
   });
   ```

   The generation check already skips a child that codex-acp itself replaced (`restartCodexClient`, which runs only for `providers/set` and `providers/disable`).
   `runWithProcessCheck` is what fails every later request once the child's `exitCode` is set.

3. Add a fourth edit whose `find` is the `finishAllAsyncTasks` line above (`count: 1`; it occurs once in 2.1.1).
   The `replace` lets `finishAllAsyncTasks` settle, writes one line to stderr that names the child's exit, and then exits codex-acp with a non-zero code.
   Bound the wait, so a task that never settles cannot keep the broken adapter alive.

4. Extend the doc comment above `edits` with what the fourth edit does and why: the platform never sends the provider calls that would restart the child, and the runtime replaces a failed harness only when the adapter process exits.

5. Update `UPSTREAM_GAPS`, the README's "codex-acp patch" section ("It patches three things" becomes four; "A release that fixes only some of the three …"), and the message in [`packages/agents/.mise/tasks/check/codex-acp-patch`](../../../packages/agents/.mise/tasks/check/codex-acp-patch).
   Name the release that makes the edit unnecessary: codex-acp 2.2.0 and later restart their `codex` process on their own (`app-server-recovery`).

6. No architecture page changes: [Sessions → Session inside the machine](../../architecture/sessions.md#session-inside-the-machine) already says that a lease whose harness crashes is respawned by the next frame.

## Acceptance criteria

- [ ] After a kill of the `codex` process, codex-acp exits, and the machine log shows the stderr line of the new edit.
- [ ] The next prompt to a Codex session that has messages works, on a new harness process, and the session keeps its history.
- [ ] A new Codex session works after the kill, with no env change.
- [ ] A Codex session with no kill runs as before, and the patch still applies as a whole: the machine log has no `codex-acp-patch: not applied`.
- [ ] `mise run //packages/agents:check:codex-acp-patch` passes, and `mise run //packages/agents:test:codex-acp-patch` passes with `CODEX_ACP` set to the 2.1.1 bundle from step 2.

## Smoke test

1. `mise run //packages/agents:check:codex-acp-patch`, then `CODEX_ACP=<scratch folder>/codex-acp/dist/index.js mise run //packages/agents:test:codex-acp-patch`: both pass.
2. Build the Codex image and install this branch on a dev cluster (`cluster-ops` skill).
   Run step 3 of the README's whole-feature smoke test: one Codex turn, `kill $(pgrep -n -x codex)` through `dam ssh connect`, then a prompt to the same session and a new session.
   Both work, and the machine log shows codex-acp's exit line and the runtime's `lease … lost its harness; the next session respawns it`.

Then print a short guide for the user to repeat step 2 by hand.
