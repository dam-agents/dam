# 02 — Runtime reports artifact touches

**Depends on:** 01-touch-record
**Part of:** session artifacts on the Home feed cards — see [README](./README.md)

## Context

This slice supplies the producer. The agent-runtime already proxies every frame between the harness
and its clients, so it sees each tool result on a frame that names its session. It recognises the
marker slice 01 added, and reports the touch to the platform. Nothing the platform sends the harness
changes, and the model is never involved.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. Where to observe

The runtime's ACP path already inspects frames and knows each one's session — see the
`session/update` handling that `history-provider.ts` reads back, and the interception points in
`packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`. Observe agent→client
frames whose update is a `tool_call_update` with a terminal `status` and a `rawOutput`.

Read the shape from the adapter rather than guessing it: `dist/acp-agent.js` in
`@agentclientprotocol/claude-agent-acp@0.66.0` emits `rawOutput: chunk.content` alongside
`status: "completed" | "failed"`. Ignore a failed status — a failed call touched nothing.

### 2. Recognise by marker, never by tool name

`rawOutput` is MCP result content: an array of blocks, the relevant one being text holding the
tool's JSON. Find the first block whose text parses as JSON carrying slice 01's marker, and
Zod-parse it with the schema that slice exported. Anything else — no marker, a version the runtime
does not know, malformed JSON, a missing artifact id — is dropped without recording and without
throwing. Do not match on the tool's name: the harness owns that string, and it is namespaced by a
convention we do not control.

### 3. Report

Call slice 01's ingest procedure with the session id from the frame and the artifact id from the
payload. The pod already reaches the platform's harness surface — reuse the existing client path
rather than adding a transport.

Retry a failed report a small, bounded number of times and give up quietly: a lost touch means a
missing chip, which the feature tolerates by design. Never let a failed report affect the frame's
delivery to the client — observation must not be able to break a conversation.

### 4. The one test

This slice authors a unit test, which is the exception the planning rules allow for a parser with
awkward edges and no manual smoke path. Test the recognition step alone: marker present, marker
absent, unknown marker version, malformed JSON, failed status, and a result whose text block is not
JSON at all.

**Fixture the happy case on a real captured frame** — run an agent, publish an artifact, and copy
the actual `session/update` frame. A hand-written fixture would keep passing while the adapter
drifted, which manufactures confidence rather than providing it. Note in the test where the capture
came from and against which adapter version.

### 5. Checks

`mise run agent-runtime:check`, `agent-runtime:test`, and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run --force agent-runtime:check`, `--force agent-runtime:test` and
      `--force common:check:comment-types` pass.
- [ ] Publishing an artifact from a session records exactly one touch naming that session.
- [ ] Revising the same artifact from the same session records a second touch at the new version.
- [ ] A tool result without the marker records nothing, and a malformed payload records nothing and
      throws nothing.
- [ ] A failed tool call records nothing.
- [ ] The unit test's happy-path fixture is a captured frame, with its origin and adapter version
      noted.
- [ ] With the platform unreachable, the conversation still streams normally to the client.

## Smoke test

```sh
mise run --force agent-runtime:check
mise run --force agent-runtime:test
```

Then against a cluster:

1. `mise run cluster:build-agent` and `mise run cluster:build-apiserver`, then wait for the pods.
2. From an agent's chat, ask it to publish a one-line artifact.
3. Confirm one touch row in Postgres naming that agent, that artifact, and the session id shown in
   the chat URL.
4. Ask it to revise the artifact, and confirm a second row at version 2.
5. Ask it to list its artifacts — a read, not a touch — and confirm no new row appears.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
