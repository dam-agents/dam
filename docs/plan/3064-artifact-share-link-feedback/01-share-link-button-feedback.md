# 01 — Distinct affordance and unmissable copy feedback on the share-link button

**Part of:** Artifact share-link button — see [README](./README.md)

## Context

The share-link button in an artifact row copies the share link for a public
artifact and opens the sharing dialog for a private one, while looking identical
in both cases. On copy it confirms only by tinting its icon green for two
seconds, and on failure it says nothing at all. This slice makes the icon
announce the outcome before the click, and makes a copy confirm both locally (a
checkmark) and globally (a toast) — with failures surfaced instead of swallowed.

Apply the `/react-ui-engineering` skill while implementing.

## Implementation plan

### 1. Let `useCopy` report the outcome to its caller

[`packages/ui/src/hooks/use-copy.ts`](../../../packages/ui/src/hooks/use-copy.ts)

`copy` currently returns `Promise<void>` and only reports through the `state` it
sets. A caller that wants to react to *this* copy cannot: reading `state` right
after `await` gives the pre-render value, and an effect on `state` misses a
second copy inside the 2s window (the timer resets, the value never transitions).

Make `copy` return the state it settled on, and export the state type:

- `export type CopyState = "idle" | "copied" | "failed";` (it is already declared,
  just not exported).
- Restructure the body of `copy` to compute the outcome into a local, then
  `setState(outcome)`, arm the reset timer as it does today, and `return outcome`.
  The signature becomes
  `copy: (value: string | (() => Promise<string | null>)) => Promise<CopyState>`.

Do **not** emit toasts from this hook — see the README for why. This step only
widens the return type; every existing caller uses `void copy(…)` and keeps
compiling untouched.

### 2. Add the shared copy-outcome toast for the artifacts module

New file: `packages/ui/src/modules/artifacts/lib/share-link.ts`, alongside the
module's existing `lib/format.ts`, `lib/kinds.ts`, and `lib/transfer.ts`.

Export one function that turns a `CopyState` into the right toast — a success
toast `Link copied.` on `"copied"` and an error toast
`Couldn't copy the link.` on anything else. Give the success toast a short
`ttl` (2500 ms) rather than the 5000 ms default: copying a link is a small,
frequent action and the toast should not linger. Leave the error toast at the
default so it is readable.

`Link copied.` is deliberately the same wording the share dialog's existing
toast action already uses ([`share-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/share-dialog.tsx)),
so the same action reads the same way everywhere.

### 3. Rework `ShareLinkButton`

[`packages/ui/src/modules/artifacts/components/artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx)
— the local `ShareLinkButton` function at the bottom of the file.

- Extend the `@carbon/icons-react` import with `Checkmark` and `Share`, keeping
  the existing alphabetical order of that import block. `Link` stays.
- Import `emitToast`'s wrapper from the new `../lib/share-link.js` (note the
  `.js` extension — this module's relative imports use it).
- Click handling branches as it does today: no `shareUrl` means
  `onShare(artifact)`, unchanged. With a `shareUrl`, pass the resolved state from
  `copy(url)` into the toast helper.
- Icon selection, in this order: `copied` renders `Checkmark` with
  `className="text-success"`; otherwise a `shareUrl` renders `Link`; otherwise
  `Share`. Keep `size={16}` for all three so the button never jitters. The
  checkmark keeps the green tint — colour is now redundant reinforcement of a
  shape change, not the only signal.
- `aria-label` keeps its existing `Copy share link` / `Sharing settings` split.
  Extend it so the copied state announces itself too — the label is what a
  screen-reader user gets, and the icon swap is invisible to them. The `tooltip`
  prop keeps its current three-way expression.

The `cn` import stays — `ArtifactRow` itself still uses it.

### 4. Toast the share dialog's inline copy button

[`share-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/share-dialog.tsx)

The dialog already toasts `Link copied.` from the *toast action* it raises after
saving, but its own inline copy button beside the read-only URL field swaps to a
checkmark and stays silent. Route that button's `copy(shareUrl)` through the same
helper so both paths in the dialog behave alike. Leave the checkmark swap and the
existing save-time toast exactly as they are.

### 5. Toast the folder-link menu item

[`folder-group.tsx`](../../../packages/ui/src/modules/artifacts/components/folder-group.tsx)
— the `Copy folder link` dropdown item.

It calls `copy(…)` and gives **no** feedback of any kind, not even the icon tint
this issue complains about. Route it through the same helper.

> Beyond the literal scope of issue #3064, which names the artifact row. It is
> included deliberately: it is the same defect in the same module, one line, and
> leaving it would ship a module where the artifact link confirms and the folder
> link next to it does not. Drop this step if the reviewer objects — nothing else
> depends on it.

## Acceptance criteria

- [ ] `copy` from `useCopy` resolves to the settled `CopyState`, and `CopyState`
      is exported. No toast is emitted from inside the hook.
- [ ] The other six `useCopy` call sites (`markdown-code-block`,
      `copyable-command`, `reveal-token`, the Anthropic provider form, the OAuth
      app hint, and the folder group) are unchanged apart from step 5, and none
      of them gained a toast.
- [ ] On a row whose artifact has no `shareUrl`, the button renders the `Share`
      icon and clicking it calls `onShare`.
- [ ] On a row whose artifact has a `shareUrl`, the button renders the `Link`
      icon, and after a click it renders `Checkmark` for the hook's 2s window.
- [ ] A successful copy emits one success toast reading `Link copied.`; a failed
      copy emits an error toast. Neither path is silent.
- [ ] The button's `aria-label` distinguishes copy, sharing-settings, and copied.
- [ ] The button occupies the same footprint in all three icon states — hovering
      down a list of mixed public and private rows produces no layout shift.
- [ ] `mise run ui:check` and `mise run ui:test` pass.
- [ ] `mise run common:check:comment-types` passes — no code comments added.

## Smoke test

Automated, against the existing suite:

```bash
mise run ui:check ::: ui:test ::: common:check:comment-types
```

Manual, in the dev UI:

```bash
mise run ui:run
```

Open `http://localhost:5173` (the dev server proxies `/api` to the cluster
api-server on `http://localhost:4444` — **http**, not https). If another worktree
already holds 5173, Vite silently serves that other checkout; confirm the page is
this branch's bundle before drawing conclusions. Then, on the Artifacts page with
at least one public and one private artifact:

1. Hover a private row — share icon, tooltip `Sharing settings…`. Click: the
   share dialog opens.
2. Hover a public row — link icon, tooltip `Copy share link`. Click: the icon
   becomes a checkmark for ~2s **and** a `Link copied.` toast appears top-right.
   Paste to confirm the clipboard holds the artifact's share URL.
3. Click the same button twice in quick succession — a second toast appears each
   time, so a user who missed the first still gets confirmation.
4. Open a folder's menu and use `Copy folder link` on a folder with shared
   artifacts — same toast.
5. Repeat step 2 on a sandbox home view's Artifacts section to confirm the shared
   row component behaves identically there.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
