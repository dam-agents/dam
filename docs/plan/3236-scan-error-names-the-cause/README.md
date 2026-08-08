# Skill source scan errors name their cause

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#3236](https://github.com/dam-agents/dam/issues/3236) (epic [#3022](https://github.com/dam-agents/dam/issues/3022))

## Goal

A skill source that fails to scan tells the user what went wrong and what to do about it,
in the two-line form the design comment specifies: a bold cause line, a plain-language fix
line, and the "Manage connections" affordance next to it. No parser, transport, or Kubernetes
text ever reaches a source card again.

The named case the design calls for is new: **"This source needs a GitHub connection"** —
distinct from the already-shipped "grant your connection access to this repository" (#2836).

## What the investigation found — read this before implementing

The handoff document in this folder (`HANDOFF.md`) proposed two candidate throw sites for the
`Unexpected token '<', "<html><bod"... is not valid JSON` string. **Both were tested and
disproven.** Its §3 is superseded by this section.

1. **Not the pod.** `ghJson` in
   [`github-rest-client.ts`](../../../packages/agent-runtime/src/modules/skills/infrastructure/github-rest-client.ts)
   reads `res.text()` and wraps `JSON.parse` in a try/catch that falls back to the raw text.
   It cannot throw a `SyntaxError`.
2. **Not the api-server → pod hop.** Every error leaving `runWithUpstreamMapping` in
   [`agent-runtime-client.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts)
   is prefixed `agent-runtime scan <agentId>: `. The card's text carries no prefix.
3. **The issue's own repro steps do not produce it.** Reproduced on the dev cluster
   (2026-08-08, api-server at `a6e9dead`): a sandbox with zero connections scanning a private
   `github.com` source returns HTTP 403 with the #2836 message. That path is already
   classified and working.

**The parse failure happens in the browser.** The UI's tRPC client uses `httpBatchLink`
([`api.ts`](../../../packages/ui/src/api.ts)), so every source's `listWithScan` rides one HTTP
request. When `/api/trpc` answers with an HTML body — a gateway error page, an expired-session
redirect, a proxy timeout — `res.json()` throws, `TRPCClientError` carries the `SyntaxError`'s
message verbatim, and `getErrorMessage` renders it. That accounts for all three observations in
the screenshot: no label prefix, both cards identical, and nothing else on the page erroring —
[`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)
swallows `sources.list` and `skills.state` failures, so the source cards are the only surface
that renders a transport failure at all.

**Consequence for the fix:** no server-side classifier can suppress that string, because the
api-server never produced it. The UI needs its own backstop (slice 02). The server work
(slice 01) is what delivers the design's named cause — it is not what silences the screenshot.

## Approach

Architecture page: [`docs/architecture/skills.md`](../../architecture/skills.md), § *api-server
skills service* and § *Listing & scan*. Read it before changing behavior.

Two ends, one contract.

**Server.** `scanForSource` in
[`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)
is the single scan dispatch for both `list` and the content read (#3203 extracted it). Every
throw that leaves it is classified into a `ScanFailure` — a `{ code, title, detail }` record
carried structurally on the tRPC error, not smuggled inside the message string. Nothing escapes
unclassified: the helper's own catch converts anything it does not recognize into the generic
failure and logs the real error server-side.

**The new signal.** `app_not_connected` is consumed in `upstream-to-trpc.ts` but **produced
nowhere in this repo** — it died with the Secrets retirement (#2858), which is why the gateway
can no longer tell us "no connection". A credential-less scan just gets a 401 or 404 from
GitHub, indistinguishable from "connected but not granted". The reliable signal is per-sandbox:
do this agent's granted connections contribute an `egress-inject` for `api.github.com`? That is
exactly what decides whether the scan can authenticate at all. A narrow port over
`listConnectionsForAgent` answers it.

**UI.** The card reads the structured failure and renders title + detail. When a response
carries no `ScanFailure` at all — the transport case — the UI substitutes its own honest
generic pair. A raw `message` string is never rendered on this surface again.

### The contract (both slices implement against this)

Declared in
[`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts)
(browser-safe, per the contract-package convention), re-exported from `types.ts`:

```ts
export const scanFailureCodes = [
  "needs_github_connection",
  "repo_unreachable",
  "agent_unreachable",
  "other",
] as const;

export const scanFailureSchema = z.object({
  code: z.enum(scanFailureCodes),
  title: z.string(),
  detail: z.string(),
});
export type ScanFailure = z.infer<typeof scanFailureSchema>;
```

On the wire: the service throws `new TRPCError({ code, message, cause: { scanFailure } })`, and
the api-server's tRPC `errorFormatter` lifts `cause.scanFailure` into `data.scanFailure` — the
same mechanism agent-runtime already uses for `data.upstream`
([`agent-runtime-api/src/trpc.ts`](../../../packages/agent-runtime-api/src/trpc.ts)).

`message` stays populated as `"<title> <detail>"`. The CLI
([`packages/cli/src/modules/skill/services/skills-service.ts`](../../../packages/cli/src/modules/skill/services/skills-service.ts))
reads `.message` and must keep working unchanged.

| `code` | `title` | `detail` | tRPC code |
|---|---|---|---|
| `needs_github_connection` | This source needs a GitHub connection | Add a GitHub connection to this sandbox, then re-scan to list its skills. If the repository should be public, check the URL instead. | `PRECONDITION_FAILED` |
| `repo_unreachable` | Can't access this repository | If it's private, grant your GitHub connection access to it, then re-scan — otherwise, double-check the repo URL. | `FORBIDDEN` |
| `agent_unreachable` | Couldn't reach this sandbox | The sandbox couldn't be reached to scan this source. Try re-scanning in a moment. | `INTERNAL_SERVER_ERROR` |
| `other` | Couldn't scan this source | Something went wrong reading this repository. Try re-scanning in a moment. | `INTERNAL_SERVER_ERROR` |

The first two rows are the design comment's copy and #2836's copy split into title + detail.
`agent_unreachable` and `other` are the backstop; `agent_unreachable` preserves a message that
already exists today rather than regressing it into the generic pair.

**Scope note.** The user's answer to the issue's first open question is **no**: a source that
needs credentials is not blocked at add time, and no follow-up issue is filed for it. Close that
open question when the PR lands.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | Server: classify every scan failure | The `ScanFailure` contract, the errorFormatter, the connections port, and the catch-all in `scanForSource` | — |
| 02 | UI: render the named cause, never raw text | Read `data.scanFailure`, fall back to the generic pair, restyle `SourceError` to the design | 01 |

Smoke-testing 01 turned up two things that changed the plan, both agreed with the owner:

- The `needs_github_connection` detail gained a hedging sentence — a mistyped repo URL is
  indistinguishable from a private one, and the design's copy was certain about a cause we
  cannot be certain of. The table above carries the shipped wording.
- The scan cache's credentialed scope moved from per-owner to **per-sandbox**. Connections are
  granted one sandbox at a time, so an owner-scoped entry let a sandbox with no GitHub
  connection be served a sibling's private list — which made this feature's whole message
  intermittent. Landed as its own commit.

## Conventions & glossary

- **Skill Source** — a git URL registered in the catalogue. **Scan** — enumerating the skills in
  one. **Sandbox** is the user-facing noun for what the code calls an agent.
- **`ScanFailure`** — the structured, user-facing verdict on a failed scan. Distinct from the
  internal error, which is logged and never sent.
- **Skills:** apply [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md)
  for slice 01 and [`/react-ui-engineering`](../../../.agents/skills/react-ui-engineering/SKILL.md)
  for slice 02. Run `mise run lint:fix` after UI edits.
- **`mise` is the only task runner.** Never call `pnpm`, `go`, `kubectl`, or `helm` directly.
  Use `mise run cluster:kubectl -- …` — a bare `kubectl` on this machine points at a different
  cluster and will silently mislead you.
- **Tests: update, don't add.** `packages/api-server/src/__tests__/unit/skills-scan-errors.test.ts`
  already covers this classifier and its assertions change with this work. Update it in place.
  No new test files.
- **Comments sparingly.** Never cite an issue, PR, or ADR from code.

## Whole-feature smoke test

On the dev cluster (`cluster-ops` skill), with the api-server and UI rebuilt
(`mise run cluster:build-apiserver`, `mise run cluster:build-ui`):

1. Create a sandbox and grant it **no** connections. Wait for it to run.
2. Open Config → Skills. Add a private GitHub source
   (`https://github.com/PetrBulanek/humr-skills-test-private` is registered on this cluster).
3. Re-scan it. The card reads **"This source needs a GitHub connection"** over "Add a GitHub
   connection to this sandbox, then re-scan to list its skills.", with an alert icon and
   "Manage connections" on the right. Clicking it lands on that sandbox's Connections tab.
4. Grant the sandbox a GitHub connection that does **not** cover that repo, re-scan: the card
   reads **"Can't access this repository"** with the grant-access detail line.
5. Grant a connection that does cover it, re-scan: the skills list renders.
6. Backstop: stop the api-server pod, then re-scan from the open page. The card reads
   **"Couldn't scan this source"** — never `Unexpected token '<'`. Restore the pod.

Traps: the dev app is `http://localhost:4444` (https 404s at Traefik); the UI service worker
serves a stale bundle after `build-ui` — check the loaded script before concluding a change
didn't apply; `cluster:build-agent` can roll the api-server back to a pre-branch pod. The scan
cache is owner-scoped with a 5-minute TTL, so **always** hit `sources.refresh` (the card's
"Re-scan") between steps or you will read a cached list from the previous connection state.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#3236](https://github.com/dam-agents/dam/issues/3236). Delete this folder in a
`chore(plan): drop …` commit before the PR is marked ready — the `Plan check` CI job blocks the
merge until it is gone.
