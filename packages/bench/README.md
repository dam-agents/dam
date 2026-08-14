# bench

Repeatable latency benchmarks against a running Platform deployment. First (and
currently only) benchmark: **session/load** — how long opening an existing
conversation takes through the ACP relay, for issue #3247 (epic #3242).

## What it measures

The stopwatch brackets exactly what the UI's history fetch does when a user
clicks into a session: open a WebSocket to
`wss://<host>/api/agents/<id>/acp?token=…`, `initialize`, send `session/load`,
consume the replayed `session/update` notifications until the response lands.
Browser rendering and agent wake are deliberately out of scope — the pod must
be `Ready` before sampling.

Two scenarios per conversation size:

- **cold** — the first-ever load of a seeded session on this pod. The runtime
  has no in-memory log entry, so the load forwards to the harness adapter,
  which spawns the per-session subprocess and replays from the on-disk store.
- **warm** — the second load of the same session, served from the
  agent-runtime's in-memory session log without touching the harness.

Per sample it records phase timestamps (ws open, initialize, first replayed
event, last event, response) plus replay volume (event count, bytes, truncation
sentinel), appended to `results/samples.jsonl`.

## Fixtures

Sessions are synthesized from `fixtures/seed-session.jsonl` — a real 5-turn
claude-code conversation (tool calls with long outputs included) manufactured
for this purpose, sanitized, and committed. The synthesizer scales it by
repeating the conversation with rewritten uuid/tool-id chains and timestamps,
so any environment can be seeded byte-identically. Fresh session ids make cold
sampling cheap: a session id never loaded on a pod is cold by definition.

The fixture targets the claude-code on-disk store
(`~/.claude/projects/<workdir-slug>/<sessionId>.jsonl`) as read by
`@anthropic-ai/claude-agent-sdk` via `@agentclientprotocol/claude-agent-acp`.
Other harnesses are out of scope. If the store format changes, a cold run
reports `0 events` loudly rather than measuring a broken path.

## Usage

Everything runs through `mise run bench:session-load -- <subcommand>`. Seeding
writes fixture files onto the agent pod via `kubectl exec` (agent container),
so your kubeconfig needs exec on that namespace. Measuring only needs a token
accepted by the ACP relay — any Keycloak bearer for the agent owner works; the
simplest source is the CLI's auth store after a `dam auth login`.

```sh
# one-time per environment: 10 short + 10 long sessions on the bench agent
mise run bench:session-load -- seed --env dev --agent agent-xxx \
  --namespace dam-dev-sandboxed --label short --repetitions 1 --count 10
mise run bench:session-load -- seed --env dev --agent agent-xxx \
  --namespace dam-dev-sandboxed --label long --repetitions 80 --count 10

# measure (cold on first-ever load, then warm on the second)
export PLATFORM_BENCH_TOKEN=…
mise run bench:session-load -- run --env dev \
  --host https://<api-host> --label short
mise run bench:session-load -- run --env dev \
  --host https://<api-host> --label long

# p50/p95 summary as a markdown table
mise run bench:session-load -- report
```

`results/` (manifests + samples) is git-ignored and append-only: re-running
accumulates history, so a fix can be verified against earlier numbers.

## Caveats

- A freshly seeded file is likely still in the node's page cache, so cold
  numbers flatter the disk read slightly. Validate against a few true
  hibernate→wake→load cycles when the disk term matters.
- The `long` label should brush the runtime's 2 MB replay log cap; the
  truncation sentinel is recorded per sample (`(clipped)` in the report) so
  clipped replays are never compared against unclipped ones unknowingly.
- Run measurements on a well-resourced agent (≥4 CPU / 4 Gi) per #3247 — the
  benchmark measures the best case, not a starved pod.
