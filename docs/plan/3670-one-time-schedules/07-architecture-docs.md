# 07 — Architecture docs

**Depends on:** 01 through 06
**Part of:** One-time tasks — see [README](./README.md)

## Context

The architecture pages are the source of truth, so they must describe the shipped one-time task before the PR is ready. Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md): explain the *why*, keep volatile detail (exact limits, env names) out, bump `Last verified:`, never reference an ADR. Run `/doc-drift` at the end.

## Implementation plan

1. **`docs/architecture/schedules.md`**:
   - Overview: a Schedule is recurring **or a single occurrence**; say why a one-time task is a Schedule and not its own concept (it needs exactly the arming, waking and delivery a recurring fire needs), and that "now" is a once with no moment.
   - A new section (e.g. "## One-time schedules") covering: no re-arm and derived completion; why no Precheck, quiet hours or continuous session; the onboarding hold not applying and the hard stop still overridden; the 24 h delivery window and late fire; results recorded by delivery (`delivering` → success on settle → `missed` on expiry) and why this differs from recurring fires; history and the 30-day prune; cancel = delete, edit only before firing; agent creation bounded by open and hourly limits (mechanism, not numbers); starter kits cannot declare one.
   - Fix the Fire section's step 1 statement that "the schedule re-arms once the commit succeeds" to scope it to recurring schedules; Session continuity: once is always fresh and typed `schedule_once`.
2. **`docs/architecture/runtime-delivery.md`**: in Event lifecycle / Expiry, document the per-kind settle and expire listeners — api-server-side, notified after commit, once per event — and that schedules use them for one-time schedules.
3. **`docs/architecture/cli.md`**: the `schedule` group line mentions one-time schedules; Headless runs keeps `dam run` as the CI verb (one sentence on how it differs from a one-time task, if not already obvious).
4. **`docs/architecture/persistence.md`**: if it enumerates session-metadata types, add `schedule_once`.
5. **`docs/ubiquitous-language.md`**: re-read the Schedule entry against the shipped behaviour; drop the `*(proposed, #3670)*` marker; move numbers that ended up configurable out of it if any remain.
6. Run `/doc-drift` over the branch and address findings.

## Acceptance criteria

- [ ] Every row of the README's "what differs" table is explained (the why, not just the what) in `schedules.md` or `runtime-delivery.md`.
- [ ] `Last verified:` bumped on every touched architecture page.
- [ ] Glossary entry no longer marked proposed and matches the code.
- [ ] `/doc-drift` reports no drift; `mise run --force check` green.

## Smoke test

- `mise run --force check` (docs checks included).
- `/doc-drift` on the branch returns clean.
