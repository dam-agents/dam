# 01 — Relabel the publish pill to a truthful "Published"

**Part of:** #3019 — see [README](./README.md)

## Context

Everything rendered lives in one file. [`standalone-skills-group.tsx:143-152`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:143) is the whole pill: an `<a href={pub.prUrl}>` carrying hand-rolled pill classes, an info-tone background, a `PullRequest` glyph, the text `In review · {sourceName}`, and the tooltip `Pull request open on {sourceName}`. Two of those — the label and the tooltip — assert a live pull-request state that is written once at publish time and never re-read. This slice replaces both with what the publish record actually proves, and reconciles the comments that name the pill by its old label.

## Implementation plan

Apply the `/react-ui-engineering` skill.

### 1. Rewrite the pill

[`packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:143-152`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:143) — replace the hand-rolled classes with the shared badge system and fix both claims:

```tsx
{pub ? (
  <a
    href={pub.prUrl}
    target="_blank"
    rel="noopener noreferrer"
    className={cn(
      badgeVariants({ variant: "muted" }),
      "shrink-0 gap-1.5 border-border font-medium transition-opacity hover:opacity-80",
    )}
    title={`Published to ${pub.sourceName} on ${new Date(
      pub.publishedAt,
    ).toLocaleString()} — opens the pull request`}
  >
    <PullRequest size={13} /> Published · {pub.sourceName}
  </a>
) : (
```

Add `import { badgeVariants } from "@/components/ui/badge";`. `cn` and `PullRequest` are already imported, and `Button` stays — the unpublished branch still uses it.

The decisions baked into that block, recorded so they don't get re-litigated mid-implementation:

- **`Published · {sourceName}`** — the issue's own wording, a drop-in for the frame's `state · source` slot, and what [`skills.md:101`](../../architecture/skills.md) already claims the badge says. It also matches the publish toast, `Published {name}`.
- **`muted`, not `info` or `success`** — grounded in how the tones are actually used here. `success` marks a live positive state (`Connected`, [`provider-row.tsx:95`](../../../packages/ui/src/modules/providers/components/provider-row.tsx:95); the frame's green `Running`) and would over-claim, since "the PR was accepted" is exactly what we can't know. `info`'s only sibling use on this very surface is the actionable drift **Update** badge ([`skill-row.tsx:68`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-row.tsx:68)) — keeping it would leave the blue "in progress" read that this issue is about. `muted` is the token this codebase uses for a recorded fact (`Private`, `Disconnected`, `you`), which is what a publish record is.
- **`border-border`** — the row's `Card` is `bg-muted` when `readOnly` ([line 118](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:118)), so a `bg-muted` pill would lose its background against it. That combination is reachable: `readOnly` with a non-empty standalone list is the *starting* sandbox case ([`skills-surface.tsx:217`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx:217)). One class keeps the pill legible on both backgrounds; `cn` is `twMerge`, so it resolves cleanly over the variant's `border-transparent`.
- **Default badge size, no padding override** — the geometry then matches the `Modified` badge on the built-in rows of the same page ([`built-in-skills-group.tsx:58`](../../../packages/ui/src/modules/sandboxes/components/skills/built-in-skills-group.tsx:58)). This makes the pill ~4px shorter than today (`py-0.5` vs `py-1`); that is the intended design-system alignment, not a regression. `font-medium` is carried over from the current pill because the size classes set no weight.
- **`PullRequest` icon stays** — it names the link's *destination*, which the relabel doesn't change, and it is the frame's glyph. The mismatch worry ("Published" with a PR glyph) doesn't hold: the glyph describes where the link goes, not the PR's state.
- **No timestamp in the pill body** — the date goes in the tooltip via `toLocaleString()`, the repo's convention for dates. There is **no relative-time helper anywhere in `packages/ui`**, so "Published 3 days ago" would mean adding one plus its refresh concerns — out of scope. The frame puts time in sub-lines, never in pills.
- **The `prUrl` link is unchanged** — that part was never wrong.

`latestPublishByName` ([line 69](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:69)) stays latest-wins: a skill published to two sources shows only the most recent. That is pre-existing behavior, and it is *more* defensible under the new label than the old one — the pill now reports an event, and the latest event is the reasonable one to report. Do not change it in this slice.

One pre-existing edge, noted rather than fixed: the optimistic client record falls back to `sourceName: ""` when the source isn't found ([`use-skills-surface.ts:421`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:421)), which would render a dangling `Published · `. It is effectively unreachable — the source came from the publish modal's own list — and it is not a regression introduced here.

### 2. Reconcile the comments naming the old label

Five are plain renames, `"In review" pill` → `"Published" pill`:

| File | Line |
|---|---|
| [`standalone-skills-group.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:68) | 68 |
| [`standalone-skills-group.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skills-group.tsx:83) | 83 |
| [`publish-skill-modal.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/publish-skill-modal.tsx:29) | 29 |
| [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:35) | 35 |
| [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:417) | 417 |

The sixth needs its *reasoning* rewritten, not renamed — [`skills-surface.tsx:105-106`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx:105):

```
// State-neutral wording about the PR: the "In review" pill is never
// refreshed against GitHub, so we can't claim the PR is still open (#3019).
```

The neutral confirm wording still stands, but for a different reason: it is no longer compensating for a stale pill, it is the same constraint the pill now respects. Replace with:

```
// Nothing here knows the PR's state, so the wording stays state-neutral —
// "isn't withdrawn", not "is still open" (#3019).
```

That keeps the one non-obvious *why* — the constraint that would otherwise get re-broken — and keeps the `#3019` reference meaningful. Leave the adjacent `// Leading space joins this onto the sentence above` comment alone.

### 3. No new test, and why

Deliberate. There is nothing to extend: no unit test in `packages/ui` references `StandaloneSkillsGroup` or `latestPublishByName`, and `packages/e2e` has zero skills coverage. A label-and-token change is verified by looking at it; a snapshot test asserting the new string would restate the diff and pin the very wording it claims to check. The repo's standing preference is to remove redundant tests, not add them. Flagging this explicitly because the plan template asks for a deliberate call rather than a reflex.

### 4. Fix and check

```bash
mise run ui:fix && mise run check
```

## Acceptance criteria

- [ ] The published pill renders `Published · {sourceName}`, and `grep -rn "In review" packages/` returns nothing.
- [ ] The tooltip names the source and the publish date and asserts nothing about the PR's state.
- [ ] The pill still links to `pub.prUrl`, opening in a new tab with `rel="noopener noreferrer"`.
- [ ] The pill is built from `badgeVariants` rather than hand-rolled pill classes, and stays legible on the `readOnly` `bg-muted` card.
- [ ] All six comments naming the old label are consistent with what the code now renders.
- [ ] `mise run check` and `mise run test` pass, with no new test files.
- [ ] The diff touches nothing outside `packages/ui/src/modules/sandboxes/` — no schema, no api-server, no architecture doc.

## Smoke test

Existing suites first — no new ones:

```bash
mise run check && mise run test
```

Then the issue's own reproduction against the local k3s dev cluster (use the `cluster-ops` skill). **Prerequisite:** a running sandbox with a user-authored standalone skill and a connected publishable GitHub source.

1. `mise run cluster:status` — confirm the cluster is up.
2. `mise run ui:run`, then open **http://localhost:5173**. Vite proxies `/api` to `http://localhost:4444` ([`vite.config.ts:44`](../../../packages/ui/vite.config.ts:44)), so the edit is picked up on save with no image rebuild — and this sidesteps the service-worker stale-bundle trap that `cluster:build-ui` hits, since the PWA plugin is inactive in dev. Note the scheme: the cluster serves **http**, not https.
3. Open the sandbox → **Skills** → "Created in this sandbox". On a skill that already has a publish record, confirm the pill reads `Published · {source}` in the neutral tone, that hovering shows the source and publish date, and that clicking opens the pull request in a new tab.
4. If no publish record exists yet, publish the skill from its row and confirm the pill appears immediately with the new label — the optimistic record at [`use-skills-surface.ts:421`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:421) fills it in ahead of the next state poll.
5. **The fix itself:** on GitHub, merge or close that pull request. Reload the Skills page. The pill must still read `Published · {source}` — unchanged and still true, where it previously kept insisting "In review". Do the same for both outcomes (merged, and closed unmerged) if two publish records are available; one is enough.
6. Stop the sandbox and confirm the read-only rendering: the pill stays visible against the dimmed `bg-muted` card rather than blending into it.

The implementing agent runs this itself, then prints a short manual guide so the owner can repeat steps 3–6 by hand.
