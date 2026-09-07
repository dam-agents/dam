# Make artifact sharing visible

> Working plan — temporary, committed on the feature branch. Deleted once the
> feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3186

**Design:** Figma `DAM-DEV`, node `2288-347` — six frames, reviewed during
planning. The frames are the source of truth. Where this plan and a frame
disagree, the frame wins.

## Goal

A user who wants to share an artifact can see how to do it, without hovering —
both in the Artifacts list and in the opened artifact.

Today every share control hides behind a hover reveal. At rest a row shows only
the title, the creating agent, the view count and a `Private` badge. Opening the
artifact is a dead end: the preview dialog offers Download, versions, Source and
Fullscreen, and offers **Open share page** only once the artifact is already
public. So the most deliberate path to sharing — open the thing you want to
share — leads nowhere, and users conclude the product cannot share artifacts at
all.

## Approach

**No backend work.** Every control this feature needs already exists and works.
`artifactLibrary.setSharing` takes visibility, `LibraryArtifact` carries
`visibility` and `shareUrl`, and
[`share-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/share-dialog.tsx)
already presents the public-link switch with its Close/Save actions — frame 6
shows it unchanged. This feature is placement and affordance in two UI
components. No tRPC procedure, schema or type changes, and no change to the
share dialog itself.

**`shareUrl` is the public flag.** The server sets it non-null only when
`visibility === "public"` (`toLibraryArtifact` in
[`artifact-library-service.ts`](../../../packages/api-server/src/modules/artifact-library/services/artifact-library-service.ts)).
Both slices rely on this, so `artifact.shareUrl` answers "is this public?" and
supplies the URL to copy in one value.

**The status badge becomes the control.** Clicking `Public` or `Private` opens
the share dialog, so the state and the control sit in one place. This settles
the issue's second open question.

**Hover-only stays the norm everywhere else.** This settles the issue's first
open question: artifacts becomes a deliberate exception, not a design-system
change. [`HOVER_ACTION`](../../../packages/ui/src/components/ui/hover-action.ts)
has nine call sites across the artifacts, files and sessions rows. **Do not
touch the constant.** Slice 01 stops applying it in one place only.

### Decisions already settled

| Decision | Why |
|---|---|
| Both `Public` and `Private` badges open the share dialog | Symmetry, and it gives a visible path to *un*-share. The Figma annotation arrow only marks `Private`, but a clickable `Public` badge is the consistent reading. |
| **Share** stays in the three-dots menu | Not everyone will think to click a status badge; some go looking in the menu. It is also the only share entry point in the chat sidebar, which this feature leaves alone. Costs nothing at rest. |
| **Open share page** is removed from the preview | The frames replace it with **Share** in the footer and **Copy link** in the toolbar. Nothing opens the public page in a new tab any more; that is intended. |
| The badge always reports `Public`/`Private`, never `Deleting soon` | Otherwise an expiring artifact would have no share control — the exact problem this issue fixes. The row already carries a separate retention countdown, so no information is lost. |
| The preview dialog owns and stacks its own share dialog | See slice 02. Wiring share through the parents would need surgery at three mount sites. |

### Surfaces that come along for free

- **Sandbox home.** [`sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
  renders the same `ArtifactRow`, so it inherits slice 01 with no extra work.
- **Home feed artifact chips.** They open the same `ArtifactPreviewDialog`, so
  they inherit slice 02.

### Surfaces deliberately left alone

- **Chat sidebar** ([`chat-artifacts-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx)).
  A compact custom row with a green dot for shared state instead of a badge. The
  frames do not cover it — see Open questions. Its overflow menu keeps the
  **Share** item, so sharing from chat still works.
- **Docked preview** ([`docked-artifact-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx)).
  Already has an always-visible labelled **Share** button. No change needed; it
  is the in-repo precedent for what this feature does elsewhere.

## Sub-issues

| #  | Done | Title | Scope | Depends on |
|----|------|-------|-------|------------|
| 01 | ✅ | [List row — visible share controls, badge as control](./01-list-row-share-controls.md) | Make the status badge interactive; stop hover-gating `Copy link` and the overflow trigger; give `Copy link` a label and show it only when public. | — |
| 02 | ✅ | [Preview dialog — share from the opened artifact](./02-preview-dialog-share.md) | Status badge into the toolbar, `Copy link` when public, an always-present **Share** in the footer that stacks the share dialog over the preview, and live artifact state so the badge stops lying after a save. | 01 |

02 reuses the interactive badge that 01 introduces, so the order is fixed.

## Open questions (with design)

Both are posted on the issue and are waiting on @laraneich12. Neither blocks
either slice — each lands as a conditional inside a slice, not as a change to
the decomposition.

1. **Is `Deleting soon` dropped as a badge state?** This plan assumes yes, and
   the reasoning is in Decisions above. If design wants a combined state
   instead, that changes one branch in `ArtifactStatusBadge` in slice 01.
2. **Does the chat sidebar list come to parity?** This plan assumes no. If
   design wants it, it becomes a third slice after these two, not a change to
   them.
3. **Minor, unresolved.** The two list frames are labelled `state = default` and
   `state = pressed` but export identically. Until design answers, use the
   design system's existing pressed/active styling rather than inventing any.

## Conventions & glossary

- **Apply the `/react-ui-engineering` skill** in both slices. Everything here is
  `.tsx` inside `packages/ui`. No server-side TypeScript is touched, so
  `/typescript-engineering` does not apply.
- **Copy link** copies the share URL to the clipboard. **Share** opens the share
  dialog. They are different controls with different jobs, and `Copy link`
  appears only when the artifact is already public.
- Reuse the existing clipboard primitives — `useCopy`
  ([`use-copy.ts`](../../../packages/ui/src/hooks/use-copy.ts)) and
  `toastCopyOutcome`
  ([`share-link.ts`](../../../packages/ui/src/modules/artifacts/lib/share-link.ts)).
  Do not write new copy handling. Copy *feedback* is out of scope — that is
  #3064.
- Out of scope, each with its own issue: what the share dialog offers (#3114
  restricted groups, #3163 expiry labels) and the post-copy feedback (#3064).
- **No new tests.** Verification is the existing suite plus the manual smoke
  tests in each slice. Sharing has no e2e or unit coverage today, and this
  change is visual placement, which a manual smoke test covers properly.
- Follow [comment guidelines](../../guidelines/comment-guidelines.md): comment
  only where the code is genuinely hard to reason about, and never cite an
  issue, PR or ADR from code. Run `mise run common:check:comment-types` after
  each slice.
- Architecture reference:
  [`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md),
  the **Sharing model** and **UI surfaces** sections.

## Whole-feature smoke test

Start the UI dev server and log in:

```bash
mise run ui:run
```

Open the URL Vite prints — confirm the port, because another worktree may
already own 5173. Then, on the **Artifacts** page:

1. A **private** artifact shows a `Private` badge and a three-dots button **with
   the pointer away from the row**. Nothing is hidden at rest.
2. Click the `Private` badge. The share dialog opens. Turn the public-link
   switch on and Save.
3. The row now shows `Public` and a labelled **Copy link**. Click it; the
   clipboard holds the share URL.
4. Click the `Public` badge. The share dialog reopens, switch already on.
5. Open the artifact by clicking the row. The preview shows a `Public` badge at
   the left of its toolbar, a **Copy link** beside Source, and **Share** in the
   footer.
6. Click **Share** inside the preview. The share dialog stacks over it. Turn the
   switch off, Save, and close the dialog. **The preview is still open**, its
   badge now reads `Private`, and **Copy link** is gone from the toolbar — the
   preview reflects the change without being reopened.
7. Open a sandbox's home view. Its Artifacts section rows behave as in steps
   1–4, since they are the same component.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3186. A final commit deletes
`docs/plan/3186-visible-share-artifact/` before the PR is marked ready — the
`Plan check` CI job blocks the PR until it is gone.
