# 02 — Resolve public pull-request state

**Depends on:** 01-record-pr-state
**Part of:** #3019 — see [README](./README.md)

## Context

This slice is where state actually gets known. The api-server reads `api.github.com` **anonymously**
for public sources — anonymous is not "with credentials", so the architecture invariant in the
README holds — and persists what it learns. It runs as a periodic job rather than inside the
`state` query, so GitHub cost tracks the number of unresolved pull requests rather than how many
users have the Skills page open.

The 60-requests/hour anonymous ceiling is the whole design constraint here. Read the README's
"Making the read affordable" section before starting; the three mechanisms it names are not
optional polish.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. Parse the pull-request coordinates

New `packages/api-server/src/modules/skills/domain/pr-url.ts`:

```ts
/** `https://github.com/{owner}/{repo}/pull/{n}` → its parts, or null when the
 *  URL is not a GitHub pull request (enterprise hosts, a moved repo, junk). */
export function parsePrUrl(
  prUrl: string,
): { owner: string; repo: string; number: number } | null
```

Domain layer, not infrastructure — it is a pure function over a string with no I/O.

Reuse [`detectHost`](../../../packages/api-server/src/modules/skills/infrastructure/git-host.ts)
for the host check rather than re-deriving what counts as GitHub. A URL that does not parse is not
an error: the record stays `null` and renders `Submitted`.

### 2. The reader

New `packages/api-server/src/modules/skills/infrastructure/pr-state-reader.ts`:

```ts
export interface PrStateReader {
  /** Conditional read. `notModified` means the cached state still stands and
   *  the call cost nothing against the rate limit. */
  read(
    coords: { owner: string; repo: string; number: number },
    etag: string | null,
  ): Promise<
    | { kind: "state"; prState: "draft" | "open" | "merged" | "closed"; etag: string | null }
    | { kind: "notModified" }
    | { kind: "unavailable"; reason: "not-found" | "rate-limited" | "error" }
  >;
}
```

`GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}` with:

- `Accept: application/vnd.github+json`
- `If-None-Match: <etag>` when an etag is stored — **this is the mechanism that makes the budget
  survivable**, because GitHub does not count a `304` against the rate limit.
- A `User-Agent` (GitHub rejects requests without one).

Map the response:

| Response | Result |
|---|---|
| `304` | `notModified` |
| `200`, `draft: true` | `draft` |
| `200`, `state: "open"` | `open` |
| `200`, `merged_at` non-null | `merged` |
| `200`, `state: "closed"` | `closed` |
| `404` | `unavailable: not-found` — private, deleted, or repo gone |
| `403`/`429` with `x-ratelimit-remaining: 0` | `unavailable: rate-limited` |
| anything else | `unavailable: error` |

Check `draft` **before** `state`, and `merged_at` before falling through to `closed` — a merged
pull request also reports `state: "closed"`, so ordering is what distinguishes landed from
abandoned.

Do not throw on `unavailable`. A badge that cannot be resolved is a normal outcome, not a fault.

### 3. Resolution pass

New `packages/api-server/src/modules/skills/services/resolve-pr-state.ts` — one exported function
the periodic job calls:

1. Select records needing a look: `prState IS NULL OR prState IN ('draft','open')`. **Terminal
   states are excluded by the query** — that is mechanism 2 from the README, and it is what makes
   the working set shrink over time instead of growing with usage.
2. Deduplicate by `prUrl` before reading. Several agents can carry a record for the same pull
   request; read it once.
3. Skip records whose source is not resolvable anonymously. Cheapest reliable signal is the
   outcome itself — a `404` means "not public" as much as "not there" — so attempt the read and
   treat `not-found` as unresolvable rather than trying to pre-classify the source.
4. On `state`, call `setPrState`. On `notModified`, update only `prStateCheckedAt`. On
   `unavailable`, leave the record untouched — **never overwrite a known state with `null`**,
   or a rate-limit blip would erase a resolved `merged`.
5. On `rate-limited`, stop the whole pass immediately and log once. Continuing would burn the
   next window's budget on requests that are certain to fail.
6. Bound the pass: cap reads per tick (start at **20**) so a large backlog cannot exhaust the hour
   in one tick. `log()` how many were skipped by the cap — a silent cap reads as "everything was
   checked" when it wasn't.

### 4. Register the job

In the api-server's composition, register via
[`core/periodic-jobs.ts`](../../../packages/api-server/src/core/periodic-jobs.ts) — it is
idempotent across replicas, so exactly one pass runs per interval per deployment regardless of
replica count.

Interval **10 minutes**. With ETags a tick over unchanged pull requests is almost free, so the
interval trades badge freshness against nothing much; 10 minutes bounds staleness to something a
user reading a badge would accept.

Follow whatever the neighbouring registrations do for wiring and naming (`periodic.` prefix is
applied by the registry).

## Acceptance criteria

- [ ] `parsePrUrl` handles `https://github.com/o/r/pull/12` and returns `null` for a non-GitHub host,
      a repo URL with no `/pull/`, and a non-numeric number.
- [ ] The reader sends `If-None-Match` when an etag is stored, and a `304` results in no state change.
- [ ] `draft`, `open`, `merged` and `closed` are each distinguished correctly, with `draft` checked
      before `state` and `merged_at` before `closed`.
- [ ] Records with a terminal `prState` are excluded by the selection query — verifiable by
      inspecting the query, and by confirming a `merged` record is not re-read on later ticks.
- [ ] An `unavailable` outcome never nulls an already-resolved state.
- [ ] A `rate-limited` outcome aborts the pass and logs once.
- [ ] The per-tick cap is enforced and logs what it skipped.
- [ ] The job is registered through `periodic-jobs.ts`, not a bare `setInterval`.
- [ ] `mise run check` and `mise run test` pass, with no new test files.
- [ ] No UI file is touched — the badge still renders from slice 01's contract, so the pill is
      unchanged in this slice.

## Smoke test

```bash
mise run check && mise run test
```

Then against the local cluster (`cluster-ops` skill), using a **public** GitHub source. The
repo `PetrBulanek/humr-skills-test` already carries usable pull requests — **#7 is closed
unmerged** and **#6 is merged** — so both terminal outcomes can be checked without opening
anything new.

1. `mise run cluster:build-apiserver`.
2. Publish a skill to the public source, then confirm the row resolves within ~10 minutes:
   ```bash
   mise run cluster:kubectl -- exec -n default platform-postgres-0 -- psql -U platform -d platform -c "select skill_name, pr_state, pr_state_checked_at, left(pr_etag, 12) from agent_skill_publishes;"
   ```
   Expect `pr_state = 'open'` and a non-null etag.
3. Close the pull request on GitHub. After the next tick, `pr_state` becomes `closed`.
4. Confirm terminal persistence: note `pr_state_checked_at`, wait two further ticks, re-query. The
   timestamp must be **unchanged** — a terminal record is never re-read.
5. Confirm the conditional read: for a still-open pull request, watch the api-server log across
   two ticks (`mise run cluster:logs`) and confirm the second produced no state change.

The badge itself does not change in this slice — that is slice 03. Verification here is the
database and the log.

The implementing agent runs this itself, then prints a short manual guide for steps 2–5.
