# 03 — Render the five states

**Depends on:** 01-record-pr-state
**Part of:** #3019 — see [README](./README.md)

## Context

The pill currently hard-codes one label. This slice turns it into a function of `prState`, and
brings back the Publish button in the one state where republishing makes sense. It depends only on
slice 01's contract, so it can land before or after 02 — until 02 is in, every record resolves
`null` and the pill reads `Submitted · {source}`, which is correct.

Everything rendered lives in
[`standalone-skills-group.tsx:143`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:143).

Apply the `/react-ui-engineering` skill — which, note, forces an extraction here. Its
list-item rule is **CRITICAL**: anything non-trivial inside a `.map(...)` becomes its own
component, where non-trivial means >~10 lines of JSX, *any* conditional branch, or *any* local
derivation. The existing map body is ~80 lines of JSX with a conditional, and this slice adds a
second branch (pill *and* button) plus a `pill` derivation. Combined with the skill's
touch-it-=-migrate-it rule, the row moves to a sibling `standalone-skill-row.tsx` — matching the
`skill-row.tsx` already in that folder — and the group keeps only the section, header slot, and
publish-record lookup. `PR_STATE_PILL` lives at module scope in the row file.

## Implementation plan

### 1. The mapping

Add a module-scope table above `StandaloneSkillsGroup` — a lookup, not a chain of ternaries in
JSX:

```tsx
/** The label answers "is this skill published upstream?", not "what happened to
 *  the pull request?" — so a merged one reads `Published`, which is why an
 *  unresolved one cannot (#3019). */
const PR_STATE_PILL: Record<
  NonNullable<SkillPublishRecord["prState"]> | "unknown",
  { label: string; variant: "outline" | "info" | "success" | "muted" }
> = {
  draft: { label: "Draft", variant: "outline" },
  open: { label: "In review", variant: "info" },
  merged: { label: "Published", variant: "success" },
  closed: { label: "Closed", variant: "muted" },
  unknown: { label: "Submitted", variant: "muted" },
};
```

Keying `unknown` alongside the real states keeps the null case inside the table rather than in a
fallback branch at the call site.

### 2. The pill

Replace the hard-coded label and variant, keeping everything else — the `badgeVariants` base, the
`prUrl` link, `target="_blank"`, `rel="noopener noreferrer"`, the `PullRequest` glyph, and
`border-border` (still needed: the read-only card is `bg-muted`, so a `muted` pill without a
border disappears into it).

```tsx
const pill = PR_STATE_PILL[pub.prState ?? "unknown"];
```

Tooltip: keep naming the source and the publish date via `formatDateTime(pub.publishedAt)`, and
**do not** add the resolved state to it — the pill body already says it, and `prStateCheckedAt` is
bookkeeping the user has no use for. The existing wording ends "— opens the pull request", which
stays true for all five states.

Retain `font-medium`; the badge size classes set no weight.

### 3. `Publish again`, in the `closed` state only

Today the pill and the button are mutually exclusive: `pub ? pill : button`. Change it so the pill
**always** renders when a record exists, and a button renders *alongside* it when
`pub.prState === "closed"`.

```tsx
{pub && <a …>{pill}</a>}
{(!pub || pub.prState === "closed") && (
  <Button … onClick={() => onPublish(skill)}>
    {pub ? "Publish again" : "Publish"} <Launch size={13} />
  </Button>
)}
```

Why only `closed` — reasoning recorded so it is not re-litigated:

- **`draft` / `open`** — a live pull request exists. A second one duplicates review burden upstream,
  and what the user actually wants is to update the existing one, which
  [`publish.ts:111`](../../../packages/agent-runtime/src/modules/skills/services/publish.ts:111)
  cannot do (it mints `platform/publish-${name}-${timestamp}`, a fresh branch every time).
- **`merged`** — the skill is in the catalog. The right next step is handing it to the source
  (slice 06), not maintaining an untracked fork that diverges from upstream with no drift
  detection. Offering `Publish` here actively steers users into that fork.
- **`unknown`** — no basis to reason, so no button. This also means the behaviour for private
  sources before slice 04 is exactly today's.
- **`closed`** — nothing landed, so there is no source relationship to fall back on and the local
  copy is all there is. Today this is a dead end; a user told "rename it and resubmit" cannot.

No backend work: there is **no double-publish guard** anywhere, records are append-only, branches
are timestamped, and `latestPublishByName` already shows the newest. Republishing is already
supported — the ternary was the only thing preventing it.

Keep the `canPublish` gate and its existing `title` on both variants.

### 4. Row layout

The row becomes name/description, pill, optional button, kebab. Keep `shrink-0` on the pill and the
button and `min-w-0 flex-1` on the text block, so the name truncates rather than the controls
wrapping. This is the only state where three controls coexist, so check it at a narrow viewport.

### 5. Fix and check

```bash
mise run ui:fix && mise run check
```

## Acceptance criteria

- [ ] Each of the five cases renders its label and variant per the README's table: `Draft`/outline,
      `In review`/info, `Published`/success, `Closed`/muted, `Submitted`/muted.
- [ ] A `null` `prState` renders `Submitted · {source}` — **not** `Published`, which now means
      "merged".
- [ ] The pill still links to `pub.prUrl` in a new tab with `rel="noopener noreferrer"` in every state.
- [ ] The tooltip names the source and publish date and asserts nothing about the pull request's state.
- [ ] The pill stays legible on the read-only `bg-muted` card in all five states.
- [ ] `Publish again` appears **only** when `prState === "closed"`, alongside the pill rather than
      replacing it; `Publish` still appears when there is no record at all.
- [ ] No button appears for `draft`, `open`, `merged` or `unknown`.
- [ ] At a narrow viewport the skill name truncates and the controls do not wrap — the text block
      keeps `min-w-0 flex-1` and the pill and button keep `shrink-0`.
- [ ] `mise run check` and `mise run test` pass, with no new test files.
- [ ] The diff touches nothing outside `packages/ui/src/modules/sandboxes/`.
- [ ] The row is extracted to `standalone-skill-row.tsx` per the skill's list-item rule, and the
      group is back under the JSX weight target.

## Smoke test

```bash
mise run check && mise run test
```

Then against the local cluster (`cluster-ops` skill). Use `mise run ui:run` and
**http://localhost:5173** — Vite proxies `/api` to `http://localhost:4444`, so edits apply on save
with no image rebuild, and it avoids the service-worker stale-bundle trap `cluster:build-ui` hits.
Note the scheme is **http**.

Driving all five states through GitHub is slow, so verify the mapping by setting the column
directly, then confirm the real path once:

1. With a publish record present, walk the states:
   ```bash
   mise run cluster:kubectl -- exec -n default platform-postgres-0 -- psql -U platform -d platform -c "update agent_skill_publishes set pr_state='draft' where skill_name='<name>';"
   ```
   Reload after each of `draft`, `open`, `merged`, `closed`, and `null`, confirming label, tone, and
   that the link still opens the pull request.
2. In the `closed` state, confirm **Publish again** appears beside the pill, and that clicking it
   opens the publish modal. In `merged`, confirm no button appears.
3. Stop the sandbox and confirm the pill stays legible against the dimmed `bg-muted` card.
4. Finally, one genuine end-to-end pass: publish a skill and confirm the optimistic record renders
   `Submitted` immediately (it has no resolved state yet), then that slice 02's job promotes it to
   `In review`.

Step 4 is the one that matters — steps 1–3 are the cheap way to see all five renderings.

The implementing agent runs this itself, then prints a short manual guide so the owner can repeat
steps 1–4.
