# 06 — Hand a merged skill over to its source

**Depends on:** 03-render-five-states, 05-dedupe-merged-row
**Part of:** #3019 — see [README](./README.md)

## Context

Slice 05 stopped the page contradicting itself, but the skill is still an **untracked** local copy:
no version, no drift detection, no `Update` badge. The good end state is the one the architecture
already describes — the skill becomes an Installed Skill Ref governed by its source, and
maintenance runs on the existing source → install → drift → Update loop.

Getting there is a **governance change**, not housekeeping: once tracked, a future install
overwrites the local copy. So it is an explicit action with an explained confirm, not something that
happens on a schedule.

This is also the slice that updates the architecture page, since it is the last one to change
observable behaviour.

Apply the `/react-ui-engineering` skill (the UI) and `/typescript-engineering` (the api-server
path).

## Implementation plan

### 1. Why a kebab item and not a toggle

The owner's design frame shows a toggle on the standalone row. Do **not** build that:

- [`skills.md:86`](../../architecture/skills.md) records a #944 decision — *"There is no install
  toggle: standalone skills are simply present on disk."* A kebab action is not that toggle, so the
  page needs a note rather than a reversal.
- A bare toggle beside a badge communicates nothing about what flipping it does. The action changes
  who owns the file; it needs a name and a sentence.
- The frame shows its toggle next to an `In review` badge, which under this feature's state machine
  could never offer tracking — nothing is upstream yet. The frame predates the state machine and is
  internally inconsistent on this point.

### 2. The action

[`standalone-skills-group.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx) —
add a `DropdownMenuItem` above `Download skill`, rendered **only** when
`pub?.prState === "merged"`:

```tsx
<DropdownMenuItem onSelect={() => onTrack(skill, pub)}>
  <Renew size={14} />
  <span className="flex-1">Track from {pub.sourceName}</span>
</DropdownMenuItem>
```

Only in `merged`: before that there is nothing upstream to track, so the item would be a dead
control in every other state.

### 3. The confirm, branching on the hash

Slice 05 exposed `contentHash` for exactly these skills, so the wording can state what will
actually happen rather than a generic warning. Use `showConfirm` as
[`skills-surface.tsx:105`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx:105)
does.

**Identical** (`standalone.contentHash === scanned.contentHash`) — a no-op swap:

> This skill will be tracked from {source}. Updates published there will keep it current.

**Diverged** — local edits are about to be lost, so say so, and point at the alternative:

> Your local copy differs from the version in {source}. Tracking replaces it with the published
> version and your local changes are lost. To contribute them instead, use **Publish again**.

Do not soften the diverged case. Losing edits the user made is the one genuinely destructive
outcome in this feature.

If the scanned counterpart cannot be found — the source has not been rescanned yet, or is
unreachable — do not guess. Disable the item with a `title` saying the source has not been scanned
yet.

### 4. Tracking it

The action is an install of the merged version. Reuse the existing install path rather than
inventing a second writer: it fetches the skill from the source at a version, writes it into every
Skill Path, and upserts the `agent_skills` row — which is precisely the migration.

Wire `onTrack` through
[`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)
next to the existing install mutation, at the merged version from the scan.

The moment the row exists, `standalone = local.filter(s => !trackedNames.has(s.name))`
([`skills-service.ts:656`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:656))
drops the skill from the standalone bucket, so the row leaves "Created in this sandbox" and the
source entry — no longer suppressed by slice 05, because it is now installed — appears with its
toggle on. One row, correctly tracked, with drift detection live.

Emit a toast on success naming what happened (`Tracking {name} from {source}`), because the row
moving between sections is a big visual change and it should be attributable.

### 5. Architecture doc

[`docs/architecture/skills.md`](../../architecture/skills.md) — update in this PR per
[`documentation-guidelines.md`](../../guidelines/documentation-guidelines.md) ("*When your work
changes the behavior or responsibility of a subsystem, update its page in the same PR*"):

- **`:86`** — "*May carry a 'Published' badge if it has a matching `agent_skill_publishes` row*" is
  now wrong in two ways. Describe the five-state badge and that the state is resolved from GitHub,
  not implied by the row's existence.
- **`:101`** — "*This is what drives the 'Published' badge*" — same correction; the record drives the
  badge's *presence*, the resolved state drives its *label*.
- **Add** a short paragraph on resolution: anonymous from the api-server for public sources,
  through the warm pod for private, conditional requests plus terminal-state persistence to live
  inside the anonymous rate budget, never waking a hibernated agent. State explicitly that the
  invariant at `:61` is preserved — anonymous reads carry no credential.
- **`:86`** again — note that a merged standalone skill offers `Track from {source}`, and that this
  is *not* the install toggle #944 rejected.
- **Bump `Last verified:`** at the top (currently `2026-07-29`) to the merge date.

Keep it terse and factual, and do not reference an ADR or this plan folder.

### 6. Fix and check

```bash
mise run ui:fix && mise run check
```

## Acceptance criteria

- [ ] `Track from {source}` appears in the kebab **only** when `prState === "merged"`.
- [ ] The identical and diverged confirms use the wording above; the diverged one names the loss and
      points at `Publish again`.
- [ ] With no scanned counterpart, the item is disabled with an explanatory `title` — never silently
      broken.
- [ ] Confirming tracks the skill via the **existing** install path; no second writer of
      `agent_skills` is introduced.
- [ ] After tracking, the skill appears once under its source with the toggle on, is gone from
      "Created in this sandbox", and drift detection works (an upstream change surfaces `Update`).
- [ ] Cancelling changes nothing on disk or in Postgres.
- [ ] A success toast names the skill and the source.
- [ ] No install toggle is added to the standalone row.
- [ ] `skills.md` is updated at `:86` and `:101`, gains the resolution paragraph, states the `:61`
      invariant is preserved, and has its `Last verified:` bumped.
- [ ] `mise run check` and `mise run test` pass, with no new test files.

## Smoke test

```bash
mise run check && mise run test
```

Then against the local cluster (`cluster-ops` skill), continuing from slice 05's state — a merged
skill showing once with a `Published` pill.

1. Kebab on the merged skill → confirm `Track from {source}` is present. On a skill in any other
   state, confirm it is absent.
2. Select it. With local and upstream identical, confirm the wording is the no-op variant. **Cancel**
   and verify nothing changed:
   ```bash
   mise run cluster:kubectl -- exec -n default platform-postgres-0 -- psql -U platform -d platform -c "select name, source from agent_skills where name='<name>';"
   ```
   Expect no row.
3. Select it again and confirm. The row must leave "Created in this sandbox" and appear under the
   source with its toggle **on**, and a toast must name the skill and source.
4. Verify governance is live: change the skill upstream in the source repo, rescan, and confirm the
   `Update` badge appears — the skill is now drift-tracked.
5. Reset, re-publish, merge, then edit the local copy so it diverges, and confirm the **diverged**
   confirm wording appears and names the loss.
6. Re-read the updated `skills.md` section and check it matches what the code now does.

Step 5 is the one worth being careful with — it is the only destructive path in this feature.

The implementing agent runs this itself, then prints a short manual guide for steps 1–5.
