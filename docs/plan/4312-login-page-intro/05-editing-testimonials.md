# 05 — Editing testimonials

**Depends on:** 04-testimonials-in-the-database
**Part of:** The login page tells a new visitor what DAM is — see [README](./README.md)

## Context

04 stores the testimonials and gives operators a tRPC surface; this slice gives them a way to use it.
In the web UI, a "Login page" card on Settings → Operator lists the testimonials, edits them in place, uploads a photo for each, and reorders them.
In the CLI, `dam login-testimonials` lists, exports and imports the whole list as JSON, so a deployment can load its testimonials once after install.

## Implementation plan

Apply `/react-ui-engineering` for the UI and `/typescript-engineering` for the CLI.

1. **UI card.** `packages/ui/src/modules/login-testimonials/` with `api/queries.ts` (list, save) and `components/login-testimonials-section.tsx`, rendered in `packages/ui/src/modules/operator/views/operator-view.tsx` after `UserBudgetsSection`, in the same section style.
   Each row shows the photo or initials, name, role and the start of the quote, with Edit, Move up, Move down and Remove.
   Add and Edit open a dialog (follow `operator-override-dialog.tsx`): name, role, quote (a textarea with a hint that `{brand}` becomes the product name), and a photo picker that posts the file to `POST /api/avatars` and shows the cropped result, with Remove photo.
   Changes save the whole list at once (Save / Discard on the card), so a half-edited list never reaches the login page.
   The card says the login page picks up a save within a minute.
2. **CLI.** `packages/cli/src/modules/login-testimonials/` following `spend`'s command and service layout: `dam login-testimonials list`, `export [file]` (JSON with `name`, `role`, `quote`, `photo` as a file path or none) and `import <file>` (uploads each photo through `POST /api/avatars`, then saves the list, after printing what it will replace and asking unless `--yes`).
   Register it in `packages/cli/src/compose.ts`.
3. **Docs.** `docs/architecture/cli.md`: the new command group.
   `docs/architecture/security-and-credentials.md` (operators): editing the login page's testimonials is an operator action.
   Update the QA profile under `.quality-inspector/qi-profile-dam/` if a journey covers the Operator page.
   Run `/doc-drift`.

## Acceptance criteria

- [ ] `mise run check` (with `check:format`, `check:lint`, `check:comment-types`, `//docs:check`) and the existing `ui` and `cli` test suites pass.
- [ ] The card shows only for operators, with the Operator tab.
- [ ] Adding, editing, reordering and removing a testimonial, with and without a photo, then Save, changes the login page on its next load; Discard leaves it unchanged.
- [ ] A photo over 2 MB, or not JPG/PNG, shows the upload's error in the dialog.
- [ ] `dam login-testimonials export` then `import` of the same file leaves the list unchanged; `import` of a file with photos shows them on the login page.

## Smoke test

Run the checks above.
`cluster:build -- ui api-server` (and the CLI built locally).
As an operator, on Settings → Operator, add the five real testimonials with a photo for one, move it to the top, Save, and open the login page in another tab: it shows them in that order.
`dam login-testimonials export /tmp/t.json`, delete one in the UI, `dam login-testimonials import /tmp/t.json --yes`: it is back.
Take the screenshots the PR body needs (`AGENTS.md` → Web UI proof).
Print a short guide so the user can repeat it.
