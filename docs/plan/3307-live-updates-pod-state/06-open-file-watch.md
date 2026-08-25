# 06 — Open-file Watch

**Depends on:** 05-workspace-tree-watch
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

The second poll in the Files panel, and the expensive one by bytes: `useFileContentQuery` refetches the **entire** open file every 2 seconds, so a 5 MB file on screen is 5 MB every 2s. The issue names only the workspace listing, but leaving this in place would mean "the steady-state polls are gone" is false whenever a file is open.

This is the one place we deliberately opt back into the `change` event class that 05 drops, because a file's contents changing is exactly what this surface renders. It needs care that directory watching does not: a save is often truncate-then-write, and many editors write a temporary file and rename it over the target, which arrives as a `rename` on the parent rather than a `change` on the file — and replaces the inode being watched.

There is exactly one open file at a time. The panel is keyed on a single path (`files-panel-controller.ts`, `docked-file-panel.tsx`), not a tab bar, so this is one extra watch rather than an unbounded set.

## Implementation plan

Apply `/typescript-engineering` for the pod, `/react-ui-engineering` for the UI.

1. **Contract** — a separate subscription from 05's, taking one path and yielding a notice that carries that path back. A separate subscription rather than a second topic on the same one: the open file changes on every click while the directory set changes rarely, so sharing an input would tear down and re-establish every directory watch each time the user browses to another file. Carrying the path back lets the client discard a late frame from a superseded subscription.
2. **Reuse 05's machinery**, extending it with:
   - the `change` event class for single-file watches;
   - a debounce, since a single save commonly fires several times;
   - **tolerance for inode replacement.** When the watched path is replaced rather than modified, re-establish the watch on the path and emit. Without this, one write-and-rename save silently ends the watch and the panel goes static — which, with no fallback poll, is invisible.
3. **UI** — in `packages/ui/src/modules/files/api/queries.ts`, delete `refetchInterval: 2000` from `useFileContentQuery` and subscribe for the currently open path, invalidating that file's content key on a notice. Subscribe only while a file is actually open, and re-subscribe when the open path changes.
4. **Save-conflict interaction — verify, don't assume.** `writeFileSafe` takes an `expectedMtimeMs` and returns `Conflict` when the file moved underneath (`packages/agent-runtime/src/modules/files.ts`). Today the 2s poll is what keeps the editor's mtime fresh, so conflicts are rare and self-healing. Pushing should make this strictly better — the mtime refreshes on the real edge instead of up to 2s late — but it changes when the editor's copy is refreshed, so exercise it explicitly rather than assuming.
5. Run `mise run ui:fix` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run check`, `mise run test` and `mise run ui:fix` are clean.
- [ ] No `refetchInterval` remains anywhere in `packages/ui/src/modules/files/api/queries.ts`.
- [ ] Appending to the open file from inside the pod updates the panel within ~1s.
- [ ] A write-and-rename save (`printf x > f.tmp && mv f.tmp f`) still updates the panel, and a *second* such save also updates it — this is the inode-replacement case, and only testing once will pass while broken.
- [ ] Closing the file ends the subscription; no notices arrive afterwards.
- [ ] Switching between files re-subscribes and does not disturb the directory watches from 05.
- [ ] With a file open and untouched, the pod emits nothing.
- [ ] Editing in the panel and saving still succeeds, and a genuine concurrent edit still reports a conflict rather than silently overwriting.

## Smoke test

`mise run check && mise run test`, then against a cluster with a file open in the panel:

```
kubectl exec -it <agent-pod> -- bash
echo "line" >> ~/work/notes.md                       # panel updates
printf 'rewritten\n' > /tmp/t && mv /tmp/t ~/work/notes.md   # updates (inode replaced)
printf 'again\n' > /tmp/t && mv /tmp/t ~/work/notes.md       # updates AGAIN — the real check
```

Then the conflict path by hand: open a file in the panel, edit it in the UI without saving, change it from inside the pod, and save. The save should be refused as a conflict rather than clobbering the pod's version. Finally, close the file and confirm the WS goes quiet.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
