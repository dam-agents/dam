# 01 — ADR: a Session can be reset in place

**Part of:** A rewind keeps the session — see [README](./README.md)

## Context

ADR-026 makes each Session's log append-only, and `sessions.md` says a harness cannot cut a session short in place, so a rewind forks.
This feature cuts in place and resets the log, which both statements rule out.
This slice records the decision and updates the docs, so slices 02–04 implement against them.

## Implementation plan

1. Read `.agents/skills/adr/SKILL.md` and `docs/adr-template.md`.
   Take the next free ADR number at commit time: 114 when this plan was written, since 109 and 112 are taken on open branches.
   Check open branches again before committing.
   Write `docs/adrs/<NNN>-session-reset-in-place.md`, `status: accepted`, `subsystem: sessions`, owner `@kapetr`.
   Do not set `supersedes`: the ADR amends ADR-026 and replaces none of it, so name the amended part in an `## Amends` section, as ADR-108 does.
   - **Decision thesis:** a harness that can cut its own stored conversation does so for a rewind or a take-back, and the runtime resets the Session — drops its log and fills it again from history under the same id — instead of adopting a copy; viewers are told once and reload.
   - Rules: the cut is an image-declared provider beside the history provider, never through the adapter; the reset notification is ephemeral; a failed cut refuses rather than forks; the first message and harnesses without the provider keep the fork.
   - Alternatives (one line each): fork as today (new id hides cost and telemetry); the cut through the adapter's `_meta` (replayed on query rebuilds, no way to persist a prompt-less cut); a logged cut frame with a position (viewers and cursors must agree on it, for a rare event).
   - Consequences: Easier — the id, spend rows, telemetry and URL survive a rewind (the study's evidence); Harder — every viewer reloads (one load per tab), and the provider reaches past the adapter into the bundled SDK, so each adapter/SDK bump must re-check `resumeSessionAt` and `resumeDropsTurn`; Committed-to — the `sessionCut` manifest field and the `platform/sessionReset` notification.
2. Run `mise run //docs:fix:adr-index`.
3. `docs/architecture/sessions.md`:
   - Lines 40–46 (history provider): add the **session-cut provider** as its sibling, in one or two sentences.
   - Lines 48–57 (rewinding and forking): replace "A harness cannot cut a session short in place, so one that can fork copies…" with the in-place cut and the reset for harnesses that declare it; keep the fork as the path for the others and for a cut before the first message.
     The rewind no longer "gives the copy the original's place" where it cuts in place.
   - Lines 58–66 (take-back): the runtime cuts in place with the guard; the guard's refusal is "the agent already answered".
   - Line 77 area: name `platform/sessionReset` among the ephemeral notifications.
   - Bump `Last verified:`.
4. `docs/ubiquitous-language.md`: add **Take-back**, **Rewind**, **Fork** (of a Session), **Session reset** to the Sessions context table, with the definitions from the README glossary.

## Acceptance criteria

- [ ] The ADR exists, its frontmatter is complete, and the generated index lists it.
- [ ] `sessions.md` no longer claims a harness cannot cut in place, and names the provider and the reset.
- [ ] The glossary has the four terms.
- [ ] `mise run //docs:check` passes (includes the ADR checks).

## Smoke test

`mise run //docs:check` and `mise run //:check:comment-types` pass.
Read the ADR's Decision paragraph alone and confirm that it answers "what happens to the Session's id on a rewind".
