# Artifact share-link button — clear affordance, unmissable copy feedback

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3064

## Goal

The link button on an artifact row does two different things depending on the
artifact, and says nothing useful about either one.

For a **public** artifact it copies the share link, and the only confirmation is
the icon tinting green for two seconds. That is easy to miss — you may have moved
the pointer away, or been looking at the row rather than the button — so people
click again to be sure. Colour is also carrying the whole signal, which is a poor
channel for anyone who does not distinguish it easily. A copy that *fails* shows
nothing at all today.

For a **private** artifact the same button opens the sharing dialog instead. The
button looks identical in both states, so you cannot tell which outcome you will
get until you have already clicked.

After this change:

- The icon differs by visibility, so the button's outcome is legible before the
  click: a link icon copies, a share icon opens sharing settings.
- A successful copy confirms twice — a checkmark where the pointer already is,
  and a toast that reaches you wherever you were looking.
- A failed copy says so, instead of failing silently.

## Approach

This is a presentation-only change inside the Artifacts UI module. No tRPC
contract, no api-server code, no schema, no architecture-page change:
[`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md)
describes the sharing model and the UI surfaces, and none of what it states
changes here. The share link, the slug, the visibility model, and the row's
existing `Private`/`Public` badge all stay exactly as they are.

Everything lives in one component:
[`packages/ui/src/modules/artifacts/components/artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx),
in the local `ShareLinkButton` function at the bottom of the file. `ArtifactRow`
is rendered from `folder-group.tsx` (the Artifacts page and the experiments
section) and from `sandbox-artifacts-section.tsx` (a sandbox's home view), so a
single edit fixes every surface that shows this button. The chat artifacts panel
and the docked artifact panel render their own markup and have no such button —
they are out of scope.

Two decisions are already settled and must not be re-opened during
implementation:

**The toast is emitted at the call site, never from inside `useCopy`.**
[`useCopy`](../../../packages/ui/src/hooks/use-copy.ts) has eight consumers —
markdown code blocks, `copyable-command`, the API-key reveal, the Anthropic
provider form, the OAuth app hint, the folder-link menu item, the share dialog,
and this row. Moving toast emission into the hook would fire a top-right toast
every time somebody copies a code block. The hook keeps its current shape and
its `idle | copied | failed` state machine; only `ShareLinkButton` reads the
`failed` state and reacts to it.

**One button slot, not two.** The button keeps its single position in the row's
hover-action cluster and changes its icon with the artifact's visibility. Two
buttons would mean a permanently disabled copy button on private rows, and
hiding the button on private rows would make the hover-action cluster a
different width from row to row.

## Conventions & glossary

- **Public / private** — an artifact's `visibility`. `artifact.shareUrl` is
  non-null exactly when the share link is live, so the component branches on
  `shareUrl`, which is what it already does.
- **Hover actions** — the button cluster revealed on row hover, via the
  `HOVER_ACTION` class from `@/components/ui/hover-action`. It is opacity-based,
  so the buttons occupy layout space at all times; changing an icon does not
  reflow the row.
- **Toasts** — `emitToast` from [`@/lib/toast`](../../../packages/ui/src/lib/toast.ts).
  Kinds are `error | warning | success | info`; `ttl` is milliseconds and
  defaults to 5000. The host is sonner, mounted top-right with `richColors` and
  a close button.
- Apply the `/react-ui-engineering` skill while implementing. Server-side
  TypeScript is not touched, so `/typescript-engineering` does not apply here.
- Project rule, worth restating because this slice edits JSX: **no code
  comments.** Run `mise run common:check:comment-types` after editing.

## Whole-feature smoke test

On the local dev cluster (`mise run cluster:*`, see the `cluster-ops` skill),
open the Artifacts page at `http://localhost:4444` with at least one public and
one private artifact in the library:

1. Hover a **private** row — the button shows the share icon and its tooltip
   reads `Sharing settings…`. Click it; the share dialog opens.
2. Hover a **public** row — the button shows the link icon and its tooltip reads
   `Copy share link`. Click it; the icon becomes a checkmark for about two
   seconds and a success toast reads `Link copied.` Paste the clipboard and
   confirm it is the artifact's share URL.
3. Confirm the same two behaviours on a sandbox home view's Artifacts section,
   which renders the same row component.

## Delivery

A single sub-issue, one atomic commit. The feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3064.
