# 01 — Clients see whether a session steers

**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

Since 2026-10-15 the web UI cannot see whether a session steers, because the lease router answers `initialize` from the manifest without the steering flag, so **Send now** never shows.
One agent can run sessions on several harnesses, so the steering fact belongs to the session, not to the agent's `initialize` answer.
This slice adds the `steering` manifest key, puts `_meta.platform.steering` on each session result, and makes the UI read it per session.
The precedent is `_meta.platform.forks`, which the runtime already puts on the same results.
After this slice, **Send now** is back on Claude Code and Codex sessions.

## Implementation plan

Apply `/typescript-engineering` to the runtime and the contract, and `/react-ui-engineering` to the UI.

1. **Manifest key.**
   In [`manifest.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/manifest.ts), add `steering: z.enum(["native", "interrupt"]).optional()`.
   Pass it to each harness's ACP runtime the way `initialize` and `harnessForks` are passed ([`compose.ts`](../../../packages/agent-runtime/src/modules/acp/compose.ts), [`server.ts`](../../../packages/agent-runtime/src/server.ts)).
   No manifest sets it yet; 06 and 08 do.

2. **The session's way to steer.**
   In [`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts), derive one value per lease: `interrupt` when the key is `interrupt`; `native` when the key is `native` or absent and the harness's own `initialize` advertises steering (`harnessSteers`); otherwise none.
   `canSteer` reads it.
   The interrupt steer itself comes in 06; until then `interrupt` behaves as none.

3. **Session results.**
   Next to `withForks`, stamp `_meta.platform.steering` with that value on the `session/new`, `session/load` and `session/resume` results, and leave it out when the session cannot steer.
   The harness has answered `initialize` before any of these results exist, so the value is known.

4. **Contract.**
   In [`packages/api-server-api/src/modules/acp/types.ts`](../../../packages/api-server-api/src/modules/acp/types.ts), add a small reader for the session results' `_meta.platform.steering`, beside the existing forks reader in the UI or in the contract, whichever owns `forks`.
   Keep `steeringSupported`: the runtime still reads the harness's own `initialize` with it.

5. **UI.**
   Read the value per session the way `sessionForksIn` reads `forks` ([`acp.ts`](../../../packages/ui/src/modules/acp/acp.ts), [`use-acp-connection.ts`](../../../packages/ui/src/modules/sessions/hooks/use-acp-connection.ts)).
   Replace `harnessSteers` in [`store/sessions.ts`](../../../packages/ui/src/modules/sessions/store/sessions.ts) with the session's steering value, and drop the `steers` value that `acp.ts` reads from `initialize`.
   In [`queued-prompts.tsx`](../../../packages/ui/src/modules/sessions/components/queued-prompts.tsx), show **Send now** when the session has a value, as today only on editable items.
   Word the tooltip by the value: native, "Send now (interrupts the agent)"; interrupt, "Send now (stops the running command)".

6. **Docs.**
   In [`sessions.md`](../../architecture/sessions.md), say that the client `initialize` answer does not carry steering and that each session result carries `_meta.platform.steering`, as it carries `forks`.
   Update **Last verified**.

## Acceptance criteria

- [ ] In a Claude Code or Codex chat, a message typed while a command runs shows under "Queued" with **Send now**, and **Send now** sends it into the running work.
- [ ] In a chat on a harness that does not steer, a message typed while a command runs shows under "Queued" without **Send now**.
- [ ] A `session/new` result on Claude Code carries `_meta.platform.steering: "native"`, and on Bob carries none.
- [ ] A reloaded chat shows **Send now** the same way as before the reload.
- [ ] `mise run check` and `mise run test` pass for `agent-runtime`, `api-server-api` and `ui`.

## Smoke test

1. `mise run cluster:build -- ui agents`.
2. In the web UI, in a Claude chat, ask for `sleep 90; echo DONE` as one command.
   During the command, type a second message.
   Expect "Queued" with **Send now**; click it and expect the message in the conversation within ten seconds.
3. Repeat step 2 in a Bob chat and expect "Queued" without **Send now**.
4. With an ACP client script, open a session on Claude Code and on Bob, and print `_meta.platform` of each `session/new` result.

Then print a short manual guide so that the user can repeat steps 2 and 3 by hand.
