# "In review" badge stays on a published skill after its pull request is closed

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#3019](https://github.com/dam-agents/dam/issues/3019)
**Epic:** [#3022 — Close the Skills usability gaps](https://github.com/dam-agents/dam/issues/3022)

## Goal

Publishing a Standalone Local Skill stamps its row with an **"In review · {source}"** pill linking to the pull request that was opened. The pill is written once at publish time and never refreshed, so it keeps asserting "In review" for the rest of the sandbox's life — after the PR merges, and after it is closed without merging. The tooltip is worse: `Pull request open on {source}` is a flat assertion about state the product never re-reads. The only way to learn the truth is to click through and discover the badge was wrong.

After this change the pill claims only what the publish record actually proves: the skill **was published** to that source, on a known date, and here is the pull request. It stops being a claim that can go stale.

User-visible outcome: `Published · {source}` in a neutral tone, tooltip `Published to {source} on {date} — opens the pull request`, same link to the PR.

## Approach

**"Say less"** (option A in the issue), not "fetch the state" (option B). In order of weight:

1. It delivers the epic's goal — *"what the interface says is true"* — at a fraction of the cost.
2. **The architecture doc already describes option A.** [`docs/architecture/skills.md:86`](../../architecture/skills.md) — *"May carry a 'Published' badge if it has a matching `agent_skill_publishes` row"* — and [`:101`](../../architecture/skills.md) — *"This is what drives the 'Published' badge"*. The implementation drifted to "In review"; this change is the code catching up to the documented design. **No architecture-doc edit is needed** — verified against the current page, which never says "In review", so there is no drift left to record and no `Last verified:` bump to make.
3. The surface is already internally inconsistent in a way this resolves. The delete-confirm dialog deliberately avoids state claims *because* the pill is never refreshed, carrying an explicit `#3019` comment ([`skills-surface.tsx:105`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx:105)), and the publish success toast already says "Published {name}" ([`use-skills-surface.ts:410`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:410)).

**Option B is out of scope.** If it is wanted later, the sane subset is the public-source half *after* [#2824](https://github.com/dam-agents/dam/issues/2824) lands, since #2824 builds the authenticated-GitHub-read-through-the-pod path that B's private half would reuse. Do not add fields, seams, or schema in preparation for it.

The issue's closing question — should the badge distinguish "merged" from "closed without merging" — is answered **no** under option A: we cannot know either state. It is deferred along with option B, not dropped.

Scope is **UI-only**: one render block plus the comments describing it. No schema change (`skillPublishRecordSchema` already carries `sourceName`, `prUrl`, `publishedAt`), no api-server change, no agent-runtime change, no migration.

### Design source

The only frame that exists is a single Skills-page mock the owner supplied. It is **pre-#3019 and depicts the bug** (`In review · dam-skills`), so it cannot arbitrate the new label. What it does settle:

- **The pill's slot shape** — `icon + state · source`, with a `·` separator — so the new label is a drop-in at the same width.
- **Time belongs in the muted sub-line**, never inside a pill (`created Jun 30`, `scanned 2h ago`). Hence no timestamp in the pill body.

Two things in that frame are deliberately not implemented and stay out of scope here: an install toggle on the standalone row (skills.md:86 — *"standalone skills are simply present on disk"*, a #944 decision) and a `created Jun 30 · only in this sandbox` sub-line where the code shows the skill description (`localSkillSchema` has no created timestamp at all, so it isn't implementable without new plumbing).

## Sub-issues

A single slice. Everything rendered lives in one file; the rest is six comments that name the pill by its old label. Splitting this would be artificial.

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Relabel the publish pill to a truthful "Published" | The pill's label, tooltip and tone in `standalone-skills-group.tsx`, plus the six comments describing it across three more files | — |

## Conventions & glossary

- **Skill Publish Record** — a row in `agent_skill_publishes`, the explicit log of a successful publish: `skillName`, `sourceId`, `sourceName`, `sourceGitUrl`, `prUrl`, `publishedAt`. Denormalized so it survives the source being renamed or deleted. This is what the pill renders. It records that a publish *happened*; it says nothing about what became of the PR.
- **Standalone Local Skill** — on the pod's PVC but not tracked in `agent_skills`. Rendered under "Created in this sandbox". Only these can be published, and only user-authored ones (`origin: "user"` or absent).
- **Apply the [`/react-ui-engineering`](../../../.agents/skills/react-ui-engineering/SKILL.md) skill** — mandated by [`packages/ui/CLAUDE.md`](../../../packages/ui/CLAUDE.md).
- **`mise` is the only task runner.** Run **`mise run ui:fix`** after UI edits (auto-fixes import order and `import type`), then `mise run check`. ⚠️ `packages/ui/CLAUDE.md` and the epic triage notes both say `mise run lint:fix` — **that task does not exist**; the real ones are `ui:fix` (this package) and `fix` (all packages). Use `ui:fix`.
- **Comments sparingly** — only the non-obvious *why*. This change touches six comments; prefer deleting a now-redundant comment over rewriting it.
- **No new tests.** There is no existing coverage of this pill to extend, and a label change does not earn a snapshot test. Reasoned in slice 01 §3.
- **Never hardcode the brand.** Not a risk here — no brand string is involved.

## Whole-feature smoke test

Single slice, so slice 01's smoke test is the whole-feature smoke test.

## Delivery

One atomic commit. The feature lands as a single PR for [#3019](https://github.com/dam-agents/dam/issues/3019), whose title follows Conventional Commits (`fix(ui): …`). The cleanup commit deleting this folder is what unblocks the `Plan check` gate.
