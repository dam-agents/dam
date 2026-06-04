# ADR-049: Lazy per-directory workspace fetch

**Date:** 2026-05-21
**Status:** Accepted
**Owner:** @tomkis

## Context

The Workspace panel polls the agent's entire working directory tree every two seconds. Once an agent checks out a real repository the payload grows unbounded; every poll re-ships thousands of paths the user can't see and won't expand. The panel becomes sluggish, wastes bandwidth on slow connections, and gets worse the longer the agent runs. The panel also surfaces no flow control beyond a hardcoded EXCLUDE list, which conflates correctness invariants with cosmetic filtering ([ADR-050](050-platform-reserved-paths.md)).

## Decision

The Workspace panel ships only what the user has chosen to look at. Directories are collapsed by default, including non-dot directories that were previously expanded on first render. On open, the panel fetches the root listing. On expansion of any directory, the panel fetches that directory's immediate children. A single batched server request carries the set of currently-open directories per poll; per-directory failures are returned independently and never abort the batch.

The set of expanded directories is per-agent and held in client memory for the lifetime of the page session. The set is pure user intent: paths the server no longer recognises are tolerated as ghosts — they continue to ship in the request, the server returns `not-found`, and the parent's listing simply omits them so the UI renders nothing for them. User-initiated deletes and renames update the set directly. Mutation handlers invalidate the whole batched query rather than splicing per-directory results.

## Alternatives Considered

- **Keep the full-tree poll, compress responses** — addresses bandwidth but not the linear-in-repo-size server cost on every poll, and still ships paths the user has demonstrably chosen not to see.
- **One independent query per open directory** — N parallel HTTP requests per poll; with many open directories the connection pool saturates and per-request overhead dominates.
- **Persist expansion state to localStorage** — survives page reload but introduces stale paths after the agent's filesystem evolves between sessions; deferred until usage data justifies it.

## Consequences

- **Easier:** Poll cost is bounded by what the user expanded, not by repo size — a Workspace with `node_modules/` checked in no longer dominates the poll cycle.
- **Easier:** The de-noised path set ([ADR-050](050-platform-reserved-paths.md)) is now safe to surface because expensive directories only ship when explicitly clicked.
- **Harder:** Opening a deeply nested file requires more clicks than before; the per-session expansion memory mitigates this only within a single tab session.
- **Harder:** Mutations affecting paths across multiple open directories no longer permit free per-directory invalidation; every mutation refetches the whole expanded set.
- **Committed-to:** Per-directory cache keying as the unit of subscription. Any future shift from polling to push delivery will reuse this shape; abandoning it would force a second migration.
