# 04 — Marquee title truncation

**Depends on:** 02-panel-folder-groups
**Part of:** Artifacts panel folders — see [README](./README.md)

## Context

Panel rows truncate long titles; the design specifies a marquee scroll so the tail is readable
without hovering for the tooltip. The spec (from the issue comment, video attached there):
TRANSLATION_X on the title, scroll distance 26px, 9s loop with `cubic-bezier(0.25, 0.1, 0.25,
1.0)` — 0–0.5s hold, 0.5–3s scroll left, 3–3.5s hold, 3.5–6s scroll back, 6–9s pause; text
clipped by the container (215px in the design), appears truncated at rest.

## Implementation plan

Apply the /react-ui-engineering skill.

1. No marquee/text-scroll animation exists in the codebase; global keyframes live in
   `packages/ui/src/App.css` (~269–429). Add the keyframes there implementing the spec's
   timeline (percentage stops over a 9s cycle), and a class applying it to the title span.
2. In the panel's `ArtifactListRow` (`packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx`),
   apply the animation **only when the title actually overflows** its container (measure
   `scrollWidth > clientWidth`; a small hook or ref effect). Non-overflowing titles stay static.
   The design's 26px is the overflow of its sample (241px text in 215px) — scroll by the row's
   real overflow, capped sensibly, rather than a hardcoded 26px.
3. Wrap the animation in `@media (prefers-reduced-motion: no-preference)` so reduced-motion
   users keep plain truncation; keep the `title` attribute tooltip either way.
4. Scope to the chat panel rows (the design's `FileRow`); other lists keep plain `truncate`.

## Acceptance criteria

- [ ] An overflowing title loops per the spec's timeline; a short title never animates.
- [ ] Reduced motion disables the animation; the tooltip fallback remains.
- [ ] No layout shift: the row clips, nothing overflows the sidebar.
- [ ] `mise run ui:check`, `mise run ui:test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manually on the Vite dev server: an artifact with a
long title scrolls and pauses per the video attached to the issue; a short one sits still;
toggle "Reduce motion" in OS settings and confirm the animation stops. Print those steps as the
manual guide for the user.
