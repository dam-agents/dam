# 01 — Move retention out of the Share dialog

**Part of:** Artifact retention stops masquerading as share-link expiry — see [README](./README.md)

## Context

The retention control currently lives inside `ShareDialog`, below the share URL
and gated on the public toggle. That placement is the defect: the container and
the neighbouring URL field both frame it as link lifetime, and the gate makes a
pending deletion invisible and uncancellable on a private artifact. This slice
gives retention its own dialog, reached from the row overflow menu next to
`Delete artifact`, and strips it out of `ShareDialog` entirely.

Apply the `/react-ui-engineering` skill throughout — this slice is `packages/ui`
only, plus one documentation line.

## Implementation plan

### 1. New retention dialog

Create
[`packages/ui/src/modules/artifacts/components/retention-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/retention-dialog.tsx).
Model its structure on the existing
[`share-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/share-dialog.tsx):
same `Modal` / `DialogHeader` / `DialogBody` / `DialogActions` from
`@/components/modal`, same `Select` from `@/components/ui/select`, same
`useSetArtifactSharing` mutation, same `emitToast` on success, same
`{ artifact, onClose }` props.

Header title: `` `Delete “${artifact.title}” automatically` ``.

Body, **in this order** — the ordering is the fix, do not rearrange:

1. **Consequence first**, as normal-weight body text (not `text-xs
   text-muted-foreground` — that weight is why today's warning goes unread):

   > This artifact and all its versions are permanently deleted on the date you
   > choose. This happens whether the artifact is public or private. You can
   > still restore it for 7 days afterwards by choosing a new date.

2. **Current state**, one line. When `artifact.expiresAt !== null`: `Currently
   deletes on <date> — <countdown>.` Format the date with the existing helpers
   in `@/lib/format-time` (`timeUntil` gives the countdown; use a locale date
   for the absolute part). When `expiresAt === null`: `This artifact is kept
   until you delete it.`

3. **The select**, labelled `Delete after`. Options carry the verb so a
   skimmer reading only the closed select still gets the truth:

   | value | label |
   |---|---|
   | `keep` | `` `Keep current date (${formattedDate})` `` — rendered **only** when `expiresAt !== null` |
   | `never` | `Never delete` |
   | `1` | `Delete in 1 hour` |
   | `24` | `Delete in 1 day` |
   | `168` | `Delete in 7 days` |
   | `720` | `Delete in 30 days` |

   Note the difference from today's `Keep current expiry`: the option names the
   date instead of hiding it. Initial state mirrors the current component —
   `keep` when an expiry exists, `never` otherwise.

Submit sends **only** the expiry, never a visibility:

```ts
sharing.mutate(
  { id: artifact.id, expiresInHours: value === "never" ? null : Number(value) },
  { onSuccess: () => { /* toast, then onClose() */ } },
);
```

Skip the mutation entirely when the selection is `keep` — just `onClose()`.
Success toast: name the outcome, e.g. `Automatic deletion turned off.` or
`` `This artifact deletes on ${formattedDate}.` ``

Check whether `DialogActions` in `@/components/modal` exposes a destructive
tone or kind prop (`ConfirmDialog` has `kind="destructive"`). Use it for the
save action **only if such a prop already exists** — do not add one.

### 2. Row menu action

In
[`artifact-row-menu-items.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row-menu-items.tsx):

- Add an `onSetRetention: (artifact: LibraryArtifact) => void` prop alongside
  `onShare`.
- Insert the item **after** the existing `DropdownMenuSeparator` and **before**
  `Delete artifact`, so it sits in the same destructive group:

  ```tsx
  <DropdownMenuItem onSelect={() => onSetRetention(artifact)}>
    Delete after…
  </DropdownMenuItem>
  ```

  Placement is deliberate: the user reaches this setting from the same mental
  drawer as deletion, not from `Share`.

In
[`artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx):
add `onSetRetention` to the exported `ArtifactRowActions` interface and thread
it to `ArtifactRowMenuItems`. Because `folder-group.tsx` and
`experiments-section.tsx` both do `interface Props extends ArtifactRowActions`
and spread `{...rowActions}`, **neither file needs an edit** — verify this
holds once `tsc` runs rather than assuming it.

### 3. Mount the dialog at the three surfaces that own row state

Each already holds a `shareTarget` and conditionally renders `ShareDialog`. Add
a parallel `retentionTarget` state and `RetentionDialog` mount next to it:

- [`views/artifacts-view.tsx`](../../../packages/ui/src/modules/artifacts/views/artifacts-view.tsx)
  — add to the `rowActions` object (~line 74) and mount beside the existing
  `ShareDialog` (~line 199).
- [`components/sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
  — pass `onSetRetention` on `ArtifactRow` (~line 71), mount beside
  `ShareDialog` (~line 78).
- [`components/chat-artifacts-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx)
  — thread through the local `ArtifactListRow` component's props the same way
  `onShare` already is (~lines 68, 87–92, 127), mount beside `ShareDialog`
  (~line 73).

Do **not** touch `docked-artifact-panel.tsx` — see the README decision.

### 4. Strip retention from the Share dialog

In `share-dialog.tsx`, delete:

- the `EXPIRY_OPTIONS` constant,
- the `expiry` state,
- the entire `{isPublic && (…Expiry…)}` block,
- the `expiresInHours` spread inside `sharing.mutate`, leaving `{ id,
  visibility }`,
- the now-unused `Select` import.

What remains is the public toggle, the URL field, and the copy button — which is
what the dialog's title has always claimed.

### 5. Architecture doc

In [`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md),
"UI surfaces" section: the Artifacts bullet lists "sharing controls" among the
page's features. Name retention as its own control there — it is no longer part
of sharing in the UI. One clause, e.g. `…folder management, sharing controls,
a separate delete-after (retention) control, and in-app previews…`. Bump
`Last verified:` at the top of the page to the implementation date.

Leave the "Sharing model" bullet about expiry alone — it already describes
retention correctly.

## Acceptance criteria

- [ ] A **private** artifact carrying an expiry shows its pending deletion in
      the `Delete after…` dialog, with the date, and `Never delete` clears it.
      This is impossible on `main`.
- [ ] `Delete after…` appears in the row overflow menu on the Artifacts page,
      the sandbox home artifacts section, and the chat artifacts panel, grouped
      with `Delete artifact` below the separator.
- [ ] The retention dialog renders the deletion consequence **above** the
      select, in body-weight text.
- [ ] The dialog names the current retention date rather than offering an
      unlabelled "keep current" option.
- [ ] The retention control renders identically whether the artifact is public
      or private — no `isPublic` condition anywhere in `retention-dialog.tsx`.
- [ ] `ShareDialog` contains no expiry control, no `EXPIRY_OPTIONS`, and sends
      no `expiresInHours`.
- [ ] Selecting `Keep current date` and saving fires no mutation.
- [ ] `folder-group.tsx` and `experiments-section.tsx` are unmodified.
- [ ] `docked-artifact-panel.tsx` is unmodified.
- [ ] `mise run check` and `mise run test` pass; `mise run ui:fix` and
      `mise run common:check:comment-types` are clean.

## Smoke test

```bash
mise run ui:fix ::: mise run check ::: mise run test
```

Then the manual path on the dev cluster, which is the one that fails on `main`.
Mint a token and seed a private artifact with a pending deletion:

```bash
TOKEN=$(curl -s -X POST "http://keycloak.localhost:4444/realms/platform/protocol/openid-connect/token" -d grant_type=password -d client_id=platform-ui -d username=dev -d password=dev -d scope=openid | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])") && curl -s -X POST http://localhost:4444/api/trpc/artifactLibrary.create -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Retention smoke","content":"# Retention smoke","fileName":"smoke.md","kind":"markdown","visibility":"private","expiresInHours":48}'
```

1. Open `http://localhost:4444` → Artifacts. The row shows a pending deletion
   and a `Private` badge.
2. Overflow menu → `Delete after…`. The dialog names the date and states the
   consequence before the select. **On `main` there is no such menu item and
   the Share dialog shows nothing at all for this artifact.**
3. Choose `Never delete`, save. The marker leaves the row.
4. Confirm server-side that the expiry is gone — expect `None`:

```bash
curl -s "http://localhost:4444/api/trpc/artifactLibrary.list?input=%7B%7D" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
for a in json.load(sys.stdin)['result']['data']:
    print(a['title'], a['visibility'], a['expiresAt'])"
```

5. Open `Share` on the same artifact: public toggle and link only.

If the UI looks stale or a field reads as missing, suspect the PWA service
worker or an api-server image skew before debugging the code.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
