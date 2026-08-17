# Artifact retention stops masquerading as share-link expiry

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3163

## Goal

A user who sets an artifact to disappear understands that the artifact is
deleted, not that a link stops working — before they choose, not after.

Today the control is labelled `Expiry`, sits in a dialog titled `Share “…”`
directly under the share URL, and only renders while the public toggle is on.
Three consequences, all reproduced on the local cluster:

1. It reads as link lifetime. The option labels (`1 hour` … `30 days`) never
   say "delete", and the sentence that does say it renders *below* the select
   in muted 12px text — after the choice is made.
2. The current value is hidden. The selected option is `Keep current expiry`,
   and the dialog never shows the date. To learn when the artifact dies the
   user must close the dialog and read the row.
3. The control disappears exactly when it matters. Turning the public link off
   unmounts it mid-dialog while the deletion stays scheduled; the toast then
   says "the artifact is now private". A private artifact with a pending
   deletion offers no view of it and no way to cancel it — and an agent can
   create private-with-expiry straight through the MCP tool, so no user
   mistake is needed to reach that state.

After this feature: retention lives in its own control, reachable whatever the
artifact's visibility, stating its consequence before the choice and naming the
date it will act on. Every user-facing surface says "deletes", not "expires".

## Approach

See [artifact library](../../architecture/artifact-library.md). The
architecture is already correct and unchanged by this work — expiry *is*
retention there ("it is a retention setting, not just a link setting, and
applies regardless of visibility"), the sweeper deletes private artifacts, and
the agent-facing MCP tool already says "Expiry is retention, not link
lifetime". **Only the UI misrepresents it.** This feature is a presentation and
placement fix, not a model change.

That is what keeps it small:

- **No contract change.** `artifactSharingInputSchema`
  ([schemas.ts](../../../packages/api-server-api/src/modules/artifact-library/schemas.ts))
  already accepts `expiresInHours` with no coupling to `visibility`, so an
  expiry-only call works today. `useSetArtifactSharing`
  ([mutations.ts](../../../packages/ui/src/modules/artifacts/api/mutations.ts))
  is reused as-is.
- **No migration, no new procedure, no new query.**
- **`ArtifactRowActions`**
  ([artifact-row.tsx](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx))
  is spread through `folder-group.tsx` and `experiments-section.tsx` via
  `{...rowActions}`, so adding one action prop propagates without editing
  either file. Only the three surfaces that own the state need a change.

The new control follows the module's existing dialog convention — a
`Modal` from `@/components/modal` rendered conditionally from the surface that
owns the target state, exactly as `ShareDialog` is rendered today. It is *not*
built on the store's `showConfirm`: that resolves a boolean only, so it cannot
carry a select.

### Decisions taken, so they are not relitigated mid-implementation

- **No separate share-link expiry.** The issue asks whether users want a link
  expiry distinct from retention. Answer: no, not on this issue. The sharing
  model states the slug is the entire access control, and one-click
  un-sharing already exists in the Public switch. A scheduled version costs a
  column, a migration, a viewer branch and an MCP argument, and puts two
  lifetime concepts back in one dialog — the very confusion being fixed.
  Scheduled un-sharing belongs to a future scheduled-actions story.
- **Wire field names stay.** `expiresInHours` (tRPC) and `expires_in_hours`
  (MCP tool) are unchanged. Renaming them would churn the contract and an
  argument agents may already call, for no user-visible gain. Only
  presentation changes.
- **The docked artifact panel is out of scope.**
  [docked-artifact-panel.tsx](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx)
  mounts `ShareDialog` from a 48px toolbar and offers no `Delete artifact`
  action at all. It gets no retention control. This is a deliberate omission,
  not an oversight.
- **The 7-day grace window stays hardcoded in copy.**
  `EXPIRATION_GRACE_PERIOD_DAYS` lives in
  [share-viewer-service.ts](../../../packages/api-server/src/modules/artifact-library/services/share-viewer-service.ts)
  and is not exported through `api-server-api`, so the UI states "7 days" as a
  literal — as today's dialog copy already does. Plumbing the constant into
  the contract is out of scope; do not add it.

## Sub-issues

| #  | Done | Title | Scope | Depends on |
|----|------|-------|-------|------------|
| 01 | ✅ | [Move retention out of the Share dialog](./01-retention-out-of-share-dialog.md) | New retention dialog, new row-menu action, ungated by visibility; expiry removed from `ShareDialog` | — |
| 02 | ☐ | [Say "deletes", not "expires"](./02-deletes-not-expires-vocabulary.md) | Row label, badge, page subtitle, share-host expired page, MCP tool description | 01 |

Slice 01 is the fix that matters: it alone closes the reported confusion and
makes a pending deletion visible and cancellable. Slice 02 is copy-only.

## Conventions & glossary

- **Retention** — how long the platform keeps the artifact. Reaching zero
  deletes the artifact and every version permanently, after a 7-day grace
  window. Independent of visibility. This is what the code calls
  `expiresAt` / `expiresInHours`.
- **Link lifetime** — how long the share URL answers. Governed *only* by the
  public/private toggle. Nothing schedules it.
- Say **"deletes"** in every user-facing string. Reserve "expires" for the wire
  field names, which do not change.
- Apply the **`/react-ui-engineering`** skill for everything in
  `packages/ui`. Apply **`/typescript-engineering`** for the server-side
  renderer and MCP tool strings touched in slice 02.
- **No code comments** (root `CLAUDE.md`). Run `mise run ui:fix` after UI
  edits and `mise run common:check:comment-types` after any code change.
- **Do not author new tests.** Verification is the existing suite
  (`mise run check`, `mise run test`) plus the manual smoke steps in each
  slice. `share-viewer-app.test.ts` asserts status codes (410/404) and not
  page strings, so slice 02's renderer copy change causes no test churn —
  confirmed by reading the test.

## Whole-feature smoke test

Against the local dev cluster (`http://localhost:4444` — http, not https).
Mint a token first:

```bash
TOKEN=$(curl -s -X POST "http://keycloak.localhost:4444/realms/platform/protocol/openid-connect/token" -d grant_type=password -d client_id=platform-ui -d username=dev -d password=dev -d scope=openid | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
```

Seed the trap case — a **private** artifact with a pending deletion, which is
what today's UI cannot show:

```bash
curl -s -X POST http://localhost:4444/api/trpc/artifactLibrary.create -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Draft strategy memo","content":"# Draft strategy","fileName":"memo.md","kind":"markdown","visibility":"private","expiresInHours":48}'
```

Then, in the Artifacts page:

1. The row reads **"deletes in 2d"**, not "expires in 2d", next to a `Private`
   badge.
2. Its overflow menu offers **`Delete after…`**, grouped with
   `Delete artifact` below the separator.
3. That dialog states the deletion consequence **above** the select, and names
   the current date ("Currently deletes on … — in 2 days").
4. Choosing **`Never delete`** and saving clears the marker from the row.
   Confirm on the server, expecting `expiresAt=None`:
   ```bash
   curl -s "http://localhost:4444/api/trpc/artifactLibrary.list?input=%7B%7D" -H "Authorization: Bearer $TOKEN" | python3 -c "
   import sys,json
   for a in json.load(sys.stdin)['result']['data']:
       print(a['title'], a['visibility'], a['expiresAt'])"
   ```
5. Open `Share` on any artifact: it now contains **only** the public toggle and
   the link. No expiry control, and toggling the link off no longer hides a
   scheduled deletion.
6. The Artifacts page subtitle no longer says "set an expiry".

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3163. The final commit deletes this
folder — the `Plan check` CI job fails while `docs/plan/` exists.
