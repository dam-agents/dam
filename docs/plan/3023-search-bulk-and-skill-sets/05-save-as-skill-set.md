# 05 — Save as skill set

**Depends on:** 04
**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

04 can store a set; nothing can create one from the UI yet. This slice adds the modal that turns the
current sandbox's selection into a named set.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Pull the design first.** In the prototype from
   [#3208](https://github.com/dam-agents/dam/issues/3208), open the `Save as skill set` modal and read
   it closely — it settles more than layout:

   - The list **starts from what is on** and every on-skill is pre-marked; the user unmarks what they
     do not want.
   - Entries are **grouped by source**, so a set reads as "these skills, from these repos" rather than
     a flat bag of names.
   - An on-skill carries an "on here" marker, distinguishing it from one the user marked by hand.
   - Footer: `N skills selected`, with `Select all` and `Clear`.
   - Create is disabled while the name is invalid **or** nothing is selected.

   Match its copy. Do not invent alternatives to these.

2. **Only source-backed skills are eligible.** The modal offers skills from connected sources and
   nothing else. The prototype states the reason on screen, and it is worth keeping verbatim in spirit:
   a set installs by name, and skills authored in the sandbox or shipped with the image have nowhere to
   install from. Filter on the same basis the surface already uses — `createdHere` and `builtIn` come
   from `origin`, so exclude both groups.

3. **Component.** New
   `packages/ui/src/modules/sandboxes/components/skills/save-skill-set-modal.tsx`. Follow the existing
   modal shape in that folder — [`publish-skill-modal.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/publish-skill-modal.tsx)
   is the closest analogue (a form over one skill with validation and a submit that can fail). Reuse
   `Input` and `Checkbox` from `@/components/ui/`.

4. **Name validation client-side, from the shared schema.** Validate with the same schema 04 exposes
   rather than a hand-written regex, so the message the user sees is the message the server would give.
   The duplicate-name check needs the existing set list, so load it when the modal opens; still handle
   the server's `CONFLICT`, because another session may have taken the name in between.

5. **Wire the action.** Add `createSet` to
   [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)
   using `runAction`, matching how `createSource` reports failures. Also expose the set list, since both
   this modal and 06's need it.

6. **Entry point.** The prototype puts `Save as skill set…` in the surface header beside
   `Add skill sets…`. Add it there, hidden while `readOnly` — the selection to save lives on a running
   pod. Disable it when nothing source-backed is installed, since an empty set is rejected by 04.

7. **After success.** Toast confirming the set was saved, and close. Do not navigate anywhere — the set
   is used from another sandbox, so there is nothing to go and look at here.

## Acceptance criteria

- [ ] The modal opens pre-marked with every installed source-backed skill, grouped by source, each on-skill marked as already on here.
- [ ] Standalone and image-shipped skills are absent, and the modal says why.
- [ ] `Select all` and `Clear` work, and the footer count tracks the marked entries.
- [ ] Create is disabled while the name is empty, invalid, or a duplicate, and while nothing is selected.
- [ ] An invalid name shows the same message the server's schema produces.
- [ ] A name taken by another session in the meantime surfaces the server's `CONFLICT` rather than failing silently.
- [ ] A saved set contains `(gitUrl, name)` pairs and is immediately visible to 06's list.
- [ ] The entry point is hidden while the sandbox is stopped or starting, and disabled when there is nothing source-backed installed.
- [ ] `mise run lint:fix` leaves the diff clean.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster at `http://localhost:4444`: on a running sandbox with several source-backed
skills installed and at least one standalone skill, open `Save as skill set`. Confirm the standalone
skill is absent and the installed ones are pre-marked and grouped. Try the name `My Set` and confirm
the rejection message, then save as `document-processing`. Query `skills.sets.list` and confirm the
entries are git-URL keyed.

Print a short manual smoke-test guide so the user can confirm it by hand.
