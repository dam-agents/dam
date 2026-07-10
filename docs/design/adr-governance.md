# ADR Governance: ADRs as an Event Log

Status: draft
Last updated: 2026-07-08

## Motivation

Agent access to ADRs was revoked because raw ADR reads are dangerous: an agent
reads a decision that was later reversed and acts on stale reasoning. We want to
grant access again, but under a stricter model that makes the log safe to read
and keeps the architecture docs small.

## Core model

Treat ADRs as an immutable event log and everything else as a projection of it.

- **ADR log** ("what was decided"). Append-only events. The only mutation
  allowed on an accepted record is stamping its supersession. Never rewritten.
- **Architecture docs** ("what is"). A projection of the log to the current
  state of the system. Lossy on purpose: rejected alternatives and dead
  branches do not appear here.
- **ADR index** ("what was decided, still live or not"). A second projection:
  a scannable list of every ADR with status and supersession, read first when
  authoring a new decision.

Two projections, one log. Neither is hand-maintained as a source of truth; both
derive from the log.

### Mental model

- ADR log = disk / write-ahead log. Never loaded wholesale. Queried via the index.
- Architecture docs = RAM. Materialized, capped, progressive disclosure.
- Index (`architecture.md` landing + `adrs/index.md`) = hot working set. Always loaded, hardest cap.

## Immutability and supersession

- An accepted ADR body is immutable. The only permitted change is to its status,
  and only to mark it superseded by another ADR.
- Supersession is authored once, as a forward link on the new ADR
  (`supersedes: <id>`). The superseded record's status is *derived*, not
  hand-stamped, so nobody has to remember to go back and edit the old file.
- Because status is derived and the index carries it, reading an old superseded
  ADR is safe: the index always shows the trajectory (012 -> 047 -> current).

## Read access: ADRs are human-first

ADRs exist for humans. The agent-facing source of truth is the architecture
docs. Agent reads of the log are the exception, justified by exactly two jobs:

1. **Authoring a new ADR.** You want the complete picture of the decision space,
   including dead branches: "did we try this path before, and why was it
   killed?" The docs delete that information by design; the log is the only
   place it lives.
2. **Recompiling the docs.** Running the fold needs the full log to produce or
   reconcile the projection. This is the only path that reads the log wholesale.

**Ordinary work** (implementing, understanding the current system) uses docs
only, never the log. The failure that got reads revoked was agents reading the
log to understand the current system; that is what the projection is for.

Reads are gated to those two flows, not a blanket allow, so a superseded
decision cannot leak into implementation work as if it were live.

## ADR index (generated)

The index is a projection, so it is generated, never hand-maintained. A
hand-written index reintroduces dual-write: the index and the ADR files can
disagree, and the agent trusts the index (it reads it first) even when it lies.

Each ADR carries structured frontmatter; the index falls out of it:

- `id`, `title`, `status`, `supersedes`, `subsystem`/`tags`, one-line `summary`.

The generator resolves supersession from the forward links and computes each
record's live/superseded status. The one-line summary is authored once in the
ADR and projected into the index, so the agent can scan one-liners, spot the two
or three relevant records, and open only those. A `check:generated`-style gate
(same shape as `db:check:generated`) fails if the committed index does not match
what regeneration produces.

## Size cap on architecture docs

The docs are RAM with a fixed budget, enforced by construction. This is the
forcing function that keeps the projection actually reduced. The point is not
to precisely budget context; it is to set *some* hard limit so the agent is
forced to lint and consolidate the doc.

- **Unit: characters.** Deterministic, zero-dependency, stable over time, and a
  human can eyeball it. A crude proxy for token cost, but precision is not the
  goal for a forcing function. Calibrate the number once against a rough token
  budget and leave it.
- **Scope, staged.** Per-page cap (the day-one lint pressure) plus an index cap
  (hardest, since the index is always loaded). Add a page-count guard later only
  if pages start splitting to dodge the per-page cap (page proliferation is the
  obvious exploit). Same unit across all scopes.
- No auto-compaction. When a recompile does not fit, consolidation is deliberate
  and staged: tighten prose, merge related statements, and push detail and
  rationale *down into the log*. Overflow pressure relocates information into an
  ADR rather than destroying it. The cap and the log are one mechanism, not two.
- Enforced, not advisory, and by one deterministic measurement reused across layers:
  - **Authoritative**: a `check:doc-size` gate (same shape as `db:check:generated`)
    that measures each page and the index against the caps and fails over budget.
    Runs in `mise run check` (already the pre-commit hook) and in CI. This is the
    layer that cannot be bypassed and that covers human edits, not just agent writes.
  - **Front-line (required)**: a PreToolUse hook on Write/Edit to
    `docs/architecture/**` that calls the same check logic and denies the write
    in-session. The point is the cycle: a rejected tool call is returned to the
    agent with its reason while the overflowing content is still in context, so
    the agent recognizes it must reconcile then and there, not at commit time
    when it has moved on. UX loop, not the guarantee (see below).
  - The rejection message must steer the reconcile, or the agent trims meaning
    to fit. It states how much it is over and prescribes the move: tighten
    prose, merge related statements, or push detail and rationale into an ADR.
    Escape hatch: if the subsystem genuinely no longer fits, its boundaries may
    be wrong — the agent stops and surfaces that to a human. Splitting a page or
    redrawing subsystem boundaries is a human decision, not an autonomous
    reconcile; do not shrink meaning.
  - Measurement: Write is trivial (content is in the tool input); Edit requires
    reading the file and simulating the substitution first. Side effect: adding
    a section before removing the old one is blocked on the intermediate state,
    which forces consolidate-before-expand. That is the wanted behavior.
  - The hook is not the guarantee. It only catches Write/Edit through the
    agent's tools; a human editor or a Bash heredoc bypasses it. The
    `check:doc-size` gate remains authoritative.
- Never silently trimmed. No auto-compaction.

## Policy enforcement

We do not hard-enforce most of the policy. We check it at review time via the
code-review agent, which can run an arbitrary skill on any PR touching
`docs/adrs/`. Split by what needs judgment:

- **Deterministic, treated as blocking**: an accepted ADR body was modified
  (anything beyond the status / superseded-by pointer). This is the one
  invariant the read model rests on, so an LLM must never own it. The logic
  lives in one standalone deterministic script (`check:adr-immutable`, sibling
  to `db:check:generated`): static tooling, no LLM. It is the authoritative gate
  in `mise run check` + CI (blocking, unbypassable). The review skill *calls the
  same script* and surfaces its result alongside the judgment findings, so the
  reviewer sees everything in one ADR report, but the skill never second-guesses
  the invariant. One check, multiple surfaces.
  - Enforces more than line edits: an ADR `accepted` in the base has a frozen
    body (only status + superseded-by pointer may change); deletion is forbidden
    (rewriting history); rename is forbidden (breaks the id). New ADRs are free.
  - Clean implementation: strip the two mutable fields, hash the remainder,
    require the hash unchanged base-to-head. Deletion and rename fall out as "a
    base id has no matching head file."
  - Base ref differs by layer: precommit diffs staged against HEAD (fast local
    loop); CI diffs the branch against its merge-base with main (authoritative,
    survives amends and rebases). Same script, different base.
- **Judgment, surfaced not blocking**: does this ADR re-litigate an already
  settled or superseded decision without acknowledging it; is the `supersedes`
  pointer aimed at the right record; is the summary honest.

These judgment checks live in a **new dedicated ADR-policy skill**, not folded
into doc-drift. The two have different scopes and inputs: doc-drift owns
docs-match-the-code (and keeps the "did an ADR change state without recompiling
the page" check); ADR-policy owns log integrity and decision judgment (ADR
files, frontmatter, git history). Keeping them separate preserves single
responsibility.

Delivery: the code-review agent runs both skills in the same pass, so
everything surfaces in one report. Unified surfacing happens at the agent level,
not by merging the skills.

## Recompile is keyed to implementation, not to the ADR

ADRs are filed before work begins; docs describe what *is*. So recompiling a
page when an ADR lands would document a system that does not exist yet. Two
clocks: the log leads reality (a decision is recorded before it is built), the
projection tracks reality (the page changes when the system changes, i.e. when
the implementing code merges). The ADR PR imposes no doc obligation.

- **Incremental recompile** (common): the implementation PR edits the page to
  match the new reality. This is the existing drift rule, discipline plus
  doc-drift surfacing. Not a deterministic gate: "is this change significant
  enough to need a doc edit, and does the doc now mismatch" is judgment. You
  cannot even build the naive gate ("ADR merged but no page changed, so block")
  because an ADR-only PR ahead of implementation is the normal, correct case.
- **Full re-fold** (occasional, deliberate): re-derive a page from the log when
  it has rotted or during a consolidation. This is the recompile read job,
  done on purpose, gated by nothing.

### Keeping the projection faithful over time

Incremental edits sediment. Each implementation PR patches the page to slot its
own change in; no single PR is wrong, but local edits optimize for fit, not for
"is the whole page still the minimal fold of the log." Over many PRs the page
becomes a pile of patches, not a clean re-derivation. This is the snapshot vs
replay divergence, except the snapshot is hand-patched prose that accumulates
cruft a pure replay never would.

Two triggers force it back, covering different rot:

- **The cap, on growth.** When incremental additions push a page over budget,
  the write is rejected and the agent must consolidate. That consolidation *is*
  a partial re-fold: it turns accumulated patches back into a clean statement.
  This is the deeper reason the cap exists. It is not a size limit, it is the
  forcing function that periodically re-minimizes the projection.
- **Supersession impact, on non-growth rot.** The cap only fires on growth. A
  page can rot without growing: a decision is superseded, the page still
  describes the old state, net size unchanged. The traceability tags catch this,
  a superseded ADR flags its subsystem's page for a re-fold look.

Full loop: incremental edits track reality; cap overflow re-minimizes on growth;
supersession flags catch same-size rot; full re-fold is the deliberate cleanup
when either signal fires. None of this guarantees `docs == fold(log)` at any
instant (see below), but it gives the discipline teeth on both axes, growth and
reversal, instead of drifting silently.

## Honesty about what holds

- **Enforceable by construction**: log immutability, the size cap,
  supersede-only status mutation, index-matches-generated. These are hooks,
  gates, or deterministic checks that reject a write.
- **Discipline only**: that the docs actually equal the reduction of the log. No
  tool can verify prose-equals-fold-of-prose. The value is not a provably
  consistent projection; it is a forcing function that keeps the projection
  small and pushes rationale into an immutable log.

## Traceability

The documentation guidelines require architecture pages to stand alone and never
link to ADRs, and that holds: docs prose stays ADR-free. Traceability serves
only the maintenance process, not readers, and only two jobs need it: recompile
scoping (which ADRs feed a page) and supersession impact (which page a
superseded ADR might have made stale). Both tolerate coarseness.

No sidecar, no dedicated forward-pointer. The `subsystem`/`tags` frontmatter
already carried for the generated index *is* the traceability, at page
granularity, which is the only level durable enough to survive doc
restructuring. The tag is a frozen historical fact ("this decision was about the
channels subsystem as it stood then"); a later page split maps old names to
current pages via an alias table rather than rewriting immutable ADRs. If
recompile scoping ever proves too coarse, generate a sidecar from those same
tags, still zero new authoring burden.

## Open questions

1. Cap unit + scope: resolved. Characters. Per-page + index cap now, page-count guard later if pages split to dodge the cap.
2. Cap enforcement: resolved. Both layers, one shared measurement: write-time PreToolUse hook (required, drives the reconcile cycle) plus authoritative `check:doc-size` gate in `mise run check` + CI (the guarantee, covers non-tool edits).
3. Immutability: resolved. Standalone deterministic `check:adr-immutable` script, authoritative gate in precommit + CI, no LLM. Review skill calls the same script for unified surfacing but never owns the invariant.
4. Skill: resolved. New dedicated ADR-policy skill (log integrity + decision judgment). doc-drift keeps docs-vs-code, including the ADR-changed-state-but-page-not-recompiled check. Both run in one code-review agent pass.
5. Traceability: resolved. None dedicated. Reuse the `subsystem`/`tags` frontmatter (already needed for the index) for page-level recompile scoping and supersession impact. Docs prose stays ADR-free. Generate a sidecar from those tags later only if scoping proves too coarse.
6. Read gating: how are the two read jobs (authoring, recompiling) technically gated so ordinary work stays docs-only? Per-flow allow, or trust the agent to separate the modes?
7. Recompile: resolved. Keyed to the implementation PR, not the ADR PR (ADRs precede reality, docs describe what is). Incremental recompile is discipline + doc-drift surfacing (judgment, not a gate); full re-fold is a deliberate read job. ADR landing imposes no doc obligation.
8. Where does this doc live long term: promote to an ADR, fold into documentation guidelines, or both?
