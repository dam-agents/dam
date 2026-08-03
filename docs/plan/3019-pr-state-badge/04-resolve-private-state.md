# 04 — Resolve private state through a warm pod

**Depends on:** 01-record-pr-state, 02-resolve-public-state
**Part of:** #3019 — see [README](./README.md)

## Context

Slice 02 resolves public sources only, so a private source's badge reads `Submitted` forever. The
credential for a private repo exists solely as an Envoy injection in the gateway pod paired with
the agent, so the read has to originate from the agent-runtime — which means the sandbox must be
running.

The runtime already makes authenticated `api.github.com` reads through that gateway: `getRepo`,
`getRef` and `getCommitHead` all go through the same `ghJson` helper, and the gateway injects
`Authorization: Bearer` for that host. So this is a new port method and a new procedure, **not** new
credential plumbing, and it does not depend on #2824.

Best-effort by design. Terminal-state persistence is what makes that acceptable: if the pod happens
to be warm when the pull request merges, `merged` is captured and kept **forever**. The badge only
ever gets more accurate — it never regresses from a terminal state.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. Runtime port

[`github-rest-client.ts`](../../../packages/agent-runtime/src/modules/skills/infrastructure/github-rest-client.ts) —
add to the `GitHubRestClient` interface and its implementation, following the shape of the existing
`getRepo`/`getRef` methods exactly (thin port, `Result`-returning, no application logic):

```ts
getPullRequest: (
  host: DetectedOwnerRepo,
  number: number,
) => Promise<Result<PullRequestState, SkillsDomainError>>;
```

```ts
export interface PullRequestState {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}
```

`GET /repos/{owner}/{repo}/pulls/{number}` via `ghJson`. Return the three raw fields rather than a
derived verdict — deriving `draft | open | merged | closed` is application concern, and slice 02
already owns that mapping. Do not duplicate the mapping here.

The existing `PullRequest` interface in this file (`{ htmlUrl }`) is the *create* response; leave it
alone and name this one distinctly.

### 2. Runtime service + procedure

Add a service method beside
[`publish.ts`](../../../packages/agent-runtime/src/modules/skills/services/publish.ts) that parses
the pull-request URL to `(host, number)` and calls the port.

Contract: add an input schema to
[`packages/agent-runtime-api/src/modules/skills/schemas.ts`](../../../packages/agent-runtime-api/src/modules/skills/schemas.ts)
and a `readPullRequest` query to
[`router.ts`](../../../packages/agent-runtime-api/src/modules/skills/router.ts:93), mirroring how
`readLocal` is declared. A **query**, not a mutation — it reads.

### 3. api-server delegation

Extend slice 02's resolution pass. For a record whose anonymous read returned `not-found`:

1. Look up the owning agent's state. **Only proceed when it is already `running`** — use
   `computeAgentState` as [`skills-service.ts:632`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:632)
   does. **Never** wake a hibernated sandbox for a badge: waking costs the user real compute and
   they did not ask for it.
2. Call `readPullRequest` through
   [`agent-runtime-client.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts),
   wrapped in `runWithUpstreamMapping` like every other method there.
3. Map the three raw fields with **the same** derivation slice 02 uses — extract that mapping into a
   shared domain function in slice 02's `pr-state-reader.ts` or a sibling domain module and call it
   from both paths. Two copies of "merged beats closed" is exactly the bug this ordering exists to
   prevent.
4. Persist via `setPrState`. A failure here is not an error: leave the record unresolved and it
   renders `Submitted`.

No ETag on this path. ETags are stored per pull request, and the value from an authenticated read
is interchangeable with the anonymous one, so reuse the stored etag if it is trivial — but do not
add complexity for it. The rate limit on the authenticated path is the user's own 5000/hour, so
the budget pressure that motivated conditional requests does not apply here.

### 4. Ordering

Attempt anonymous **first**, always. It is free of any credential, works while hibernated, and
covers the common case. Only a `not-found` escalates to the pod. This mirrors the runtime's own
anonymous-first-then-authenticated pattern for scans, and it means a public source never involves a
pod.

## Acceptance criteria

- [ ] `getPullRequest` exists on `GitHubRestClient` and returns `{ state, draft, mergedAt }` raw —
      no derived verdict in the port.
- [ ] `readPullRequest` is a **query** on the runtime's skills router with an input schema in the
      contract package.
- [ ] The api-server escalates to the pod **only** on `not-found`, and **only** when the agent is
      already `running`.
- [ ] No code path can wake a hibernated agent as part of state resolution.
- [ ] The `draft | open | merged | closed` derivation is defined **once** and used by both the
      anonymous and the pod path.
- [ ] A failed or unavailable pod read leaves the record unresolved rather than nulling a known state.
- [ ] `mise run check` and `mise run test` pass, with no new test files.

## Smoke test

```bash
mise run check && mise run test
```

Then against the local cluster (`cluster-ops` skill). The dev cluster already has a private
source — **`HUMR Private Test`** (`github.com/PetrBulanek/humr-skills-test-private`) — so no new
setup is needed.

1. `mise run cluster:build-apiserver && mise run cluster:build-agent` — both sides changed.
   ⚠️ `build-agent` can leave a pre-branch api-server pod running; confirm with
   `mise run cluster:status` that the api-server pod is the new one.
2. With the sandbox **running**, publish a skill to the private source. Within ~10 minutes:
   ```bash
   mise run cluster:kubectl -- exec -n default platform-postgres-0 -- psql -U platform -d platform -c "select skill_name, source_name, pr_state from agent_skill_publishes;"
   ```
   Expect `pr_state = 'open'` — resolved through the pod, since anonymous would 404.
3. Merge or close that pull request. After the next tick, the terminal state is captured.
4. **Hibernate the sandbox.** Confirm two things: the badge falls back to `Submitted` for any
   record that never resolved, and a previously captured terminal state is **still shown**, proving
   persistence.
5. Confirm no wake: watch `mise run cluster:status` across several ticks with the sandbox
   hibernated and verify no agent pod starts.

Step 5 is the one to be careful about — an accidental wake is a real cost regression and is easy to
introduce here.

The implementing agent runs this itself, then prints a short manual guide for steps 2–5.
