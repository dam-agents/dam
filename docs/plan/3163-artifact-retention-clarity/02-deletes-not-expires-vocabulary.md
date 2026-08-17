# 02 — Say "deletes", not "expires"

**Depends on:** [01-retention-out-of-share-dialog](./01-retention-out-of-share-dialog.md)
**Part of:** Artifact retention stops masquerading as share-link expiry — see [README](./README.md)

## Context

Slice 01 fixed where the control lives. This slice fixes what every other
surface calls it. The row says "expires in 29d", the badge says `Expired`, the
page subtitle says "set an expiry", and the public share page says "This link
has expired" — each one reinforcing the mental model the issue reports. The
share page also promises the owner "can still renew it from the artifact
library", an affordance that had no name until slice 01 created it.

Copy-only, across `packages/ui` and two server-side string sites. No behavior
changes. Apply `/react-ui-engineering` for the UI files and
`/typescript-engineering` for the api-server files.

## Implementation plan

### 1. Row label and state naming

In
[`lib/format.ts`](../../../packages/ui/src/modules/artifacts/lib/format.ts):

- Rename `expiryState` → `deletionState` and `ExpiryState` → `DeletionState`,
  so the code carries the same vocabulary as the UI. Update both call sites
  (`artifact-row.tsx`, `artifact-badges.tsx`).
- Keep the three-state shape. Change the labels:
  - `active`: `` `deletes in ${largestUnit(delta)}` ``
  - `expired`: `deletion pending` — a flat string, no elapsed time. Past the
    retention date the artifact still exists inside the grace window and is
    restorable, so "deleted 3h ago" would be a lie and "expired 3h ago" is the
    wording being retired. Drop the `largestUnit` call in this branch.

Leave the `soon` flag and the state key names (`never` / `active` / `expired`)
as they are — they are internal, and renaming the keys spreads the diff for no
user-visible gain.

In
[`artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx):
update the import and the local `const expiry = …` binding name to match. The
`text-danger` / `text-warning` treatment and the `opacity-55` on a
pending-deletion row all stay.

### 2. Badge

In
[`artifact-badges.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-badges.tsx):
`ArtifactStatusBadge` renders `Expired` for the past-date state. Change the
label to `Deleting soon`, keeping `variant="danger"` and keeping the existing
precedence over the `Private` / `Public` badges.

### 3. Page subtitle

In
[`artifacts-view.tsx`](../../../packages/ui/src/modules/artifacts/views/artifacts-view.tsx)
(~line 103): `"Pages and files created by you and your agents. Share with a
link, set an expiry."` → drop the sharing frame from retention, e.g. `"Pages
and files created by you and your agents. Share with a link, or set them to
delete automatically."`

### 4. Share-host expired page

In
[`renderer.ts`](../../../packages/api-server/src/modules/artifact-library/viewer/renderer.ts),
`renderExpired`. Today both branches share the heading `This link has expired`
and the grace branch promises a renew action. Give each branch its own heading
and make the promise match what slice 01 built:

- `withinGrace: true` — heading `This artifact is scheduled for deletion`;
  detail along the lines of "Its retention date has passed. The owner can still
  restore it from their artifact library for a short time."
- `withinGrace: false` — heading `This artifact has been deleted`; detail "Its
  retention date passed and its content is no longer available."

Update the `chromePage` title argument (`"410 — expired"`) to match the new
wording. Keep the 410 status in
[`viewer-app.ts`](../../../packages/api-server/src/modules/artifact-library/viewer/viewer-app.ts)
unchanged — `share-viewer-app.test.ts` asserts the status code, and 410 Gone
remains correct for both branches.

Leave `renderNotFound` alone. Its "was made private, or has been deleted"
wording is already accurate, and keeping it indistinguishable from a
nonexistent slug is deliberate per the architecture page.

`renderFolderPage` receives `expiresAt` per artifact — check whether it renders
a visible expiry label. If it does, bring it in line with the row wording; if it
only carries the field, leave it.

### 5. Agent-facing tool description

In
[`mcp-tools.ts`](../../../packages/api-server/src/modules/artifact-library/mcp-tools.ts):
the `setSharing` description (~line 289) is already correct — leave it. The
create-tool description (~line 80) says "add an expiry to bound its lifetime",
which is the vague framing. Make it name the consequence, e.g. "set
`expires_in_hours` to have the platform delete the artifact automatically". The
`expires_in_hours` field description (~line 103) is already explicit; leave it.

Do **not** rename the tool argument or the schema field — see the README
decision.

## Acceptance criteria

- [ ] No user-facing string in `packages/ui/src/modules/artifacts/` uses
      "expire"/"expiry"/"expired". Verify with a grep; the only remaining hits
      are the `expiresAt` / `expiresInHours` field names.
- [ ] The row reads "deletes in 29d"; a past-date artifact reads "deletion
      pending" and carries a `Deleting soon` badge.
- [ ] The Artifacts page subtitle no longer frames retention as a sharing
      setting.
- [ ] The share-host page distinguishes "scheduled for deletion" (restorable)
      from "has been deleted", and its restore sentence describes the control
      slice 01 actually built.
- [ ] `share-viewer-app.test.ts` passes unmodified — it asserts status codes,
      not strings.
- [ ] `mise run check` and `mise run test` pass; `mise run ui:fix` and
      `mise run common:check:comment-types` are clean.

## Smoke test

```bash
mise run ui:fix ::: mise run check ::: mise run test
```

Confirm the vocabulary sweep left nothing behind — expect hits only on field
names:

```bash
grep -rn -i "expir" packages/ui/src/modules/artifacts/
```

Then, on the dev cluster, seed one artifact with a near-term retention date and
read the row and badge by eye:

```bash
TOKEN=$(curl -s -X POST "http://keycloak.localhost:4444/realms/platform/protocol/openid-connect/token" -d grant_type=password -d client_id=platform-ui -d username=dev -d password=dev -d scope=openid | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])") && curl -s -X POST http://localhost:4444/api/trpc/artifactLibrary.create -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Vocabulary smoke","content":"# Vocabulary smoke","fileName":"vocab.md","kind":"markdown","visibility":"public","expiresInHours":1}'
```

The row must read "deletes in 1h", and the Artifacts page subtitle must not
mention an expiry.

The past-date share page is not reachable by hand — `expiresInHours` is
constrained to positive integers by
[`schemas.ts`](../../../packages/api-server-api/src/modules/artifact-library/schemas.ts),
so no API call produces an already-expired artifact. Verify those two branches
by reading `renderExpired` and running the existing
`share-viewer-app.test.ts` 410 case, and say so plainly in the report rather
than claiming a manual check that did not happen.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
