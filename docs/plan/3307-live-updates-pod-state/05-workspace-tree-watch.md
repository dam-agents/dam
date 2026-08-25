# 05 — Workspace tree Watch

**Depends on:** 02-ui-per-agent-client-websocket
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

The Files panel re-reads its whole batched listing every 2 seconds. This slice replaces that with a Watch and builds the pod-side watch machinery that sub-issue 06 reuses.

Two facts make this much cheaper than it first appears.

**Scope is bounded by user intent, not repo size.** ADR-049's committed-to clause says per-directory cache keying is the unit of subscription and that any shift to push delivery reuses that shape. The panel already ships the exact set it cares about — `paramsForExpanded` builds `["", ...expanded].sort()` — so the Watch covers those directories, non-recursively, and nothing else. A collapsed `node_modules` is never watched. Recursive watching would burn one inotify watch per directory on a real checkout, which is what ADR-049 was written against.

**Only structural change matters.** `DirEntry` is `{ name, type }` — no size, no mtime (`packages/agent-runtime-api/src/modules/files/types.ts`). So a content write cannot change a listing; only create, delete and rename can. That is exactly Node's `rename` event class, and it means a build churning inside a watched directory is almost entirely silent.

## Implementation plan

Apply `/typescript-engineering` for the pod, `/react-ui-engineering` for the UI.

1. **Contract** — add a `watch` subscription to the files router (`packages/agent-runtime-api/src/modules/files/router.ts`) taking the same `paths` array `listDirs` already takes, and yielding a bare notice meaning "re-read the listing". Share the 500-path cap from `fileListDirsInputSchema` so the two inputs cannot disagree.
2. **Watch machinery** — new module under `packages/agent-runtime/src/modules/`, kept separate from `files.ts` so 06 can reuse it. It must:
   - watch each requested path **non-recursively**, resolving through the same containment check `files.ts` uses (`safePath`) and honouring the same reserved-path rules, so the Watch cannot observe anything `listDirs` would refuse to show;
   - filter to the `rename` event class for directory watches, dropping `change`;
   - coalesce on a ~250ms trailing debounce, so a `git checkout` creating hundreds of entries yields one notice;
   - **re-attempt paths it could not watch.** ADR-049 deliberately keeps ghost paths in the expanded set forever, so the input routinely names directories that do not exist. When a notice fires, retry the unwatched ones — that is how a directory created by the agent starts being watched without the client re-subscribing.
3. **Degrade internally, not on the wire.** Where filesystem notification is unavailable, fall back to an internal `readdir` diff on a timer and keep emitting notices. The storage class is operator-configurable (`controller.agent.base.storageClass`, empty by default so the k3s local-path provisioner is used, but it can be pointed at network-backed storage where inotify gives nothing), and a large checkout can exhaust the node's watch limit, which nothing in `deploy/` tunes. The client must never learn the difference — ADR-084 makes detection private to the pod, so there is one client path rather than two.
4. **Lifetime is the subscription.** Watches are established on subscribe and torn down on unsubscribe. No subscriber ⇒ no watches, no timers.
5. **UI** — in `packages/ui/src/modules/files/api/queries.ts`, delete `refetchInterval: 2000` from `useDirSnapshot` and subscribe instead, invalidating `fileKeys.tree(agentId)` on each notice.
   **The subscription cannot live in `useDirSnapshot`.** Every mounted `DirContents` calls that hook and `select`s its own slice out of one shared query (`dir-contents.tsx`), so N directory rows would open N subscriptions. Put it once in the panel controller (`files-panel-controller.ts`) and let the shared query do the rest.
6. The path set is the subscription input, so expanding a directory re-subscribes and the resulting `sync` notice is the refetch that fetches the newly-expanded children. That mirrors today's behaviour exactly, where expanding changes the query key and triggers a fetch — no new mechanism needed.
7. Keep the mutation-driven `invalidateFiles` calls as they are; a user's own action should not wait for a round trip through the pod.
8. Run `mise run ui:fix` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run check`, `mise run test` and `mise run ui:fix` are clean.
- [ ] No `refetchInterval` remains on the directory-listing query.
- [ ] A file created inside a watched directory from outside the UI appears within ~1s; deleting it removes it.
- [ ] A file created inside a **collapsed** directory produces no notice — nothing the user can see changed.
- [ ] Writing to an existing file's contents produces no tree notice (`change` events are dropped).
- [ ] Expanding a directory fetches its children exactly once.
- [ ] With the panel open and the filesystem quiet, the pod emits nothing.
- [ ] N open directory rows result in one subscription, not N.
- [ ] A ghost path in the expanded set does not error, and starts being watched if a directory later appears at it.
- [ ] Creating many files at once yields a coalesced notice rather than one per file.

## Smoke test

`mise run check && mise run test`, then against a cluster with an agent running and its chat view open:

```
kubectl exec -it <agent-pod> -- bash
touch ~/work/hello.txt          # appears in the panel
rm ~/work/hello.txt             # disappears
echo more >> ~/work/existing.md # tree does NOT refetch
mkdir -p ~/work/deep/nested && touch ~/work/deep/nested/x  # nothing, deep is collapsed
git -C ~/work clone <small repo> # one coalesced update, not hundreds
```

Watch DevTools → Network → WS frames throughout: notices only when something structural changed in a watched directory, and complete silence while the filesystem is quiet.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
