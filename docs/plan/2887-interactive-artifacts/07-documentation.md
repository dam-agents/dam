# 07 — Documentation

**Depends on:** 09-artifact-brief
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

Four pages stop being true the day this ships, and the Artifact Library has no vocabulary
section at all — its terms currently live borrowed inside the experiments section. This slice
makes the docs describe what was built. It is last on purpose: the pages are the source of truth
for the system, so they describe behaviour that exists.

## Implementation plan

Follow [`documentation-guidelines.md`](../../guidelines/documentation-guidelines.md). Do not
reference an ADR from any page.

1. **[`docs/ubiquitous-language.md`](../../ubiquitous-language.md)** — open an Artifact Library
   bounded-context section and define Interactive Artifact, Artifact Request, Artifact Session,
   and `answer_artifact_request`. State that Callback is an explaining word only, and that
   Invocation belongs to agent-to-agent requests and is not this.
2. **[`artifact-library.md`](../../architecture/artifact-library.md)** — a section on interactive
   artifacts: why the app brokers every call and what that buys, why interactive is settled at
   create beside the existing paragraph on kind, why an interactive artifact cannot be shared,
   and the caps. The page already anticipates this ("the planned agent-calling bridge"); update
   that sentence to describe what exists.
3. **[`agent-lifecycle.md`](../../architecture/agent-lifecycle.md)** — Wake lists three ways an
   agent is woken. Add the fourth, and note that an open interactive page keeps an agent out of
   hibernation and why that is bounded by the idle stop.
4. **[`usage-tracking.md`](../../architecture/usage-tracking.md)** — a request a person made is an activity
   event, an automatic one is not, and the reason is the existing actor rule rather than a new
   exception.
5. **`Last verified:`** — update the date on every page touched.

## Acceptance criteria

- [ ] The vocabulary has an Artifact Library section defining all four terms.
- [ ] Each of the three architecture pages describes the built behaviour, not a plan.
- [ ] The artifact-library page no longer describes the bridge as planned.
- [ ] No page references an ADR.
- [ ] `Last verified:` updated on every page changed.
- [ ] `mise run check` passes, including prettier formatting.

## Smoke test

`mise run check`, then run the `/doc-drift` skill against the branch and confirm it reports no
drift between the diff and the architecture pages.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
