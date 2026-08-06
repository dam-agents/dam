# Scope the skill scan cache to the credentials that produced each scan

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3197

## Goal

A cached skill scan is reused only by requests whose access is equivalent to the one that
produced it. Scans performed without credentials keep sharing one entry across all users, as
they do today; scans performed with a user's connected credentials are served only back to that
user.

## Approach

The skills subsystem caches a source's scanned skill list for five minutes so repeated views
don't re-read the repository. See the **scan cache** bullet under "api-server skills service" in
[`docs/architecture/skills.md`](../../architecture/skills.md).

There are two ways a scan is produced, and the architecture page already distinguishes them:

- **Public-archive scanning** — the api-server downloads the repository archive directly from
  GitHub with no credentials. The result is identical no matter who asks.
- **Private / non-GitHub fallback** — the scan runs inside the owner's agent pod, and the
  request picks up that owner's credentials at the paired gateway. The result depends on who
  asked.

The cache does not currently distinguish them: it keys entries on repository and subdirectory
alone, so one entry serves both kinds and every user. The fix records, on each entry, which of
the two produced it — and for the credentialed kind, whose credentials — then requires a lookup
to match before serving a hit.

Keeping **one entry per repository + subdirectory** (rather than widening the key) is deliberate:
invalidation stays a single delete and `sources.refresh` and the post-publish hook need no
change at all. A stored entry that doesn't match the caller is simply treated as a miss, and the
caller's own scan overwrites the slot.

### Accepted trade-off

Today, a credentialed entry also satisfies the public-archive lookup that runs first. That is
exactly the behaviour being removed, and removing it costs a repeat archive probe: listing a
credentialed source will re-probe the repository archive on each view instead of once per cache
window. The probe is a single request that fails fast, and listing is not a hot path — one call
per source per view of the skills surface. Caching the "not publicly readable" outcome would
remove the repeat probe entirely, but it adds negative-result semantics to a cache that has
none. Out of scope here; revisit if the probe shows up in practice.

A second, smaller consequence: a source that reaches the credentialed path but happens to be
publicly readable — a non-GitHub source, say — is now scanned once per owner instead of once
overall. Correct, if slightly conservative, and it affects only repeat scans of the same URL by
different owners.

## Conventions & glossary

- **Scan scope** — what a cache entry's result depended on: *shared* for an uncredentialed
  scan whose result is the same for everyone, or *owner* for a scan that ran with a particular
  user's credentials. Introduced by this work; not existing vocabulary.
- Apply the `/typescript-engineering` skill — this is server-side TypeScript throughout. No UI
  changes are involved.
- The architecture page is the source of truth for the subsystem; keep its scan-cache
  description accurate as part of the slice, per
  [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).

## Whole-feature smoke test

Same as the single sub-issue's smoke test — see [01](./01-scope-cached-scans.md).

## Delivery

One atomic commit, landing as a single PR for
[#3197](https://github.com/dam-agents/dam/issues/3197).
