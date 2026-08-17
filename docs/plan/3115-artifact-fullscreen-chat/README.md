# Expand an artifact to full screen from the chat view

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3115

## Goal

A user expands the artifact preview docked beside a conversation to full screen in one
click, and exits back to the same conversation. Today that preview is the only artifact
preview surface with no path to a bigger view: the panel is narrow, the chat keeps its
share of the window, and anything with real layout — a dashboard, a wide table, a report —
renders squeezed. To read it, the user leaves the conversation for the library, a
download, or a share link. The capability already exists one surface over; this feature
makes it reachable from the conversation that produced the artifact.

## Approach

This is UI-only wiring in [`packages/ui/src/modules/artifacts/`](../../../packages/ui/src/modules/artifacts/).
No contract, service, or persistence change. The subsystem is the
[artifact library](../../architecture/artifact-library.md) — specifically its **docked
preview** surface beside the conversation.

Three components already carry the whole mechanism:

- [`FullscreenPreviewDialog`](../../../packages/ui/src/modules/files/components/fullscreen-preview-dialog.tsx)
  — a portal to `document.body`, `fixed inset-0`, its own title bar with a Close button,
  Esc to exit, and body scroll locked while open. It is the shared full-screen shell.
- [`ArtifactPreviewDialog`](../../../packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx)
  — the library's preview. It owns the affordance this feature copies: a `Maximize` icon
  button in the toolbar, shown only while the rendered preview is visible and hidden in
  Source view.
- [`FileViewer`](../../../packages/ui/src/modules/files/components/file-viewer.tsx) — the
  chat's *file* panel, which already does this from a docked panel. It is the closer
  structural precedent: it renders its preview body in exactly **one** place, moving that
  body into the full-screen dialog and leaving a short placeholder behind in the panel.

The missing piece is only
[`DockedArtifactPanel`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx),
the chat's artifact panel, whose header stops at version switcher, Share, Source,
Download, Close.

Decisions that bound the work:

- **Reuse `FullscreenPreviewDialog`, do not build a second full-screen shell.** The issue
  asks the chat and the library to behave the same way; sharing the shell makes that true
  by construction — same placement, same Esc, same exit control.
- **One live frame, not two.** The library dialog mounts a *second* `DeferredFrame` for
  its full-screen copy. Do not copy that here: an artifact is arbitrary author-controlled
  HTML in a sandboxed iframe, and two mounted copies run its scripts, timers, and network
  work twice. Follow the file viewer instead — render the frame element in one place at a
  time.
- **Rendered preview only.** The control appears when the panel shows the iframe, and not
  in Source view — the rule the library preview already applies. Source is highlighted
  code in a scrollable panel, and it has no full-screen path on any surface today.
- **Derive the open state, do not synchronize it.** Whether the full-screen view shows is
  a function of the panel's own state (fullscreen requested **and** the frame is the
  visible body **and** preview content has loaded). Deriving it means toggling Source or
  losing the preview cannot strand an overlay showing nothing.
- **The conversation is never unmounted.** The overlay is a portal above the app, so chat
  scroll position, streaming, and the docked panel's own state survive the round trip.
  This is what "back again without losing their place" means, and it is free — do not add
  navigation or a route for the full-screen view.

Out of scope, per the issue: the panel's other controls, and how artifacts render.

## Architecture docs

**No architecture page changes.** [`artifact-library.md`](../../architecture/artifact-library.md)
describes the docked preview at one line under "UI surfaces" and never mentions a
full-screen affordance on *any* surface — not the library preview that has had one all
along, nor the file viewer. Adding a control that matches an undocumented existing one
creates no drift, and a per-control inventory sits below the level the
[documentation guidelines](../../guidelines/documentation-guidelines.md) set for
architecture pages.

## Conventions & glossary

- **Docked artifact panel** — the artifact preview beside the conversation in the chat
  view, rendered by `DockedArtifactPanel`. The issue calls it "the chat artifact panel".
- **Library preview** — the modal on the Artifacts page, `ArtifactPreviewDialog`. The
  reference behavior for this feature.
- **Rendered kind** — an artifact whose content previews as an iframe rather than as
  source (`isRenderedKind`, [`lib/kinds.ts`](../../../packages/ui/src/modules/artifacts/lib/kinds.ts)).
- Apply the `/react-ui-engineering` skill — this is React + TypeScript in
  `packages/ui`. No server-side TS is touched, so `/typescript-engineering` does not
  apply.
- No code comments (project rule). Run `mise run ui:fix` after edits, then
  `mise run ui:check` and `mise run common:check:comment-types`.

## Whole-feature smoke test

On the dev cluster (`http://localhost:4444` — http, not https), open a sandbox session
whose agent has published an HTML artifact.

1. Open the artifact from the session sidebar's Artifacts section. The docked panel opens
   beside the conversation and renders the preview.
2. Click the expand control in the panel header. The artifact fills the window.
3. Press `Esc`. The overlay closes, the conversation is exactly where it was, and the
   docked panel still shows the same artifact at the same version.
4. Re-open full screen, then click **Close** in the overlay's title bar. Same result.
5. Switch the panel to **Source**. The expand control is gone.

## Delivery

One sub-issue — [01](./01-expand-docked-artifact-preview.md) — is the whole feature: a
single atomic commit. The feature lands as one PR for
[#3115](https://github.com/dam-agents/dam/issues/3115).
