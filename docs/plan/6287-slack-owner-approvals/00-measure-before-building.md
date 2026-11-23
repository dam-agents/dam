# 00 — Measure before building

**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

Two facts decide details of the later slices, and nobody has measured them:

- how long the common clients, and each harness's own model client, wait on a held request before they give up, which decides how the cards word "Allow once" and how long a thread can wait;
- whether Stop on a turn, or a client that gives up, closes the call through to the gateway, so that the gateway's `signal` fires, for each harness.

This slice measures both on the local cluster and writes the results into the README's "Measured" table.
No code lands: a temporary log line used for a measurement is never committed.

## Implementation plan

1. **Set up.** Bring up the local cluster with Slack wired (the `cluster-ops` skill; a worktree passes `--helm-values=`) and `APPROVAL_HOLD_SECONDS=1800`.
   Use a Slack test workspace whose app has agent messaging, so the working status shows Stop.
   Use one agent per harness (Claude Code, Codex, Bob, Pi) with no network rule for a test host such as `example.org`, and no web-search rule.
2. **Client waits.** From an agent's shell, send a request to the test host through the gateway and note when it gives up and with which error:
   - `curl` with no timeout flag;
   - Python `requests` with no timeout;
   - Node `fetch`;
   - each harness's own fetch tool (Claude Code's web fetch, and its Bash tool with its default timeout; Bob's, Codex's and Pi's).
     Leave the request unanswered on Home until the client gives up or the hold window ends.
3. **Model clients.** A web search is held on the harness's model call, so the harness's model client decides how long the turn waits.
   For each harness, start a turn that searches the web, leave the search approval unanswered, and note when the model call gives up and what the turn shows.
4. **Stop and a closed client.** The MCP hold already logs `hold-abandoned` when its `signal` fires; the network and web-search holds do not listen yet.
   Add a temporary local log line on the gRPC `cancelled` event in `packages/api-server/src/apps/ext-authz/grpc.ts`, and do not commit it.
   For each harness, start a turn in the Slack test channel that fetches the test host, press Stop on the working status, and check whether the line appears.
   Repeat for a web search, and with a client that gives up on its own (step 2): the line must appear when it gives up.
5. **Write it down.** Fill the README's "Measured" table: each client, model client and harness, when it gives up, and whether Stop or a closed client cancels the gateway's check.
6. **Tell Petr** when a harness does not cancel on Stop: on that harness, a Slack-turn hold keeps its thread busy until the hold window ends, and the plan needs a decision before [01](./01-one-hold-decision.md).

## Acceptance criteria

- [ ] The README's "Measured" table lists each client of step 2, each harness's model client on a held web search, and each harness, with the time it gives up on a held request.
- [ ] The table says, for each harness, whether Stop cancels the gateway's check for a network request and for a web search, and whether a client that gives up does.
- [ ] No code change is committed.
