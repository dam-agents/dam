# 05 — Architecture documentation

**Depends on:** 01, 02, 03, 04
**Part of:** Public Agent Page — see [README](./README.md)

## Context

CLAUDE.md makes the pages under `docs/architecture/` the source of truth for the system, and requires
reading a subsystem's page before changing its behaviour. This feature adds the platform's first
unauthenticated app-origin surface and changes a documented contract in `channels.md`, so it does not
land until the docs describe it.

The glossary rows for **Public Agent Page** and **Agent Footer** were already added to
[ubiquitous-language.md](../../ubiquitous-language.md) during design. Do not duplicate them.

Follow [documentation-guidelines.md](../../guidelines/documentation-guidelines.md).

## Implementation plan

### 1. New page: `docs/architecture/public-agent-page.md`

Add it to the subsystem list in [`docs/architecture.md`](../../architecture.md) with a one-line summary.

The page must carry the four decisions a future reader would otherwise undo, each with its *why*:

- **Trust boundary.** Unauthenticated, on the app origin, not the share host. The share host exists to
  contain user-generated content; this is platform chrome. State this explicitly, because "put it on the
  share host, that's the public one" is the obvious wrong move.
- **No identity.** Tokens live in `sessionStorage`, so the server sees no credential on a navigation and
  the page cannot tell an owner from a stranger. There is no auto-redirect, and adding one would mean a
  silent-auth iframe on every stranger's visit.
- **Exposure rule.** Named only for an agent holding at least one channel binding; unknown, unbound, and
  deleted all render one identical generic page at HTTP 200, so the URL is not an oracle. Note the
  accepted consequence: **releasing a binding retroactively blanks every historical Slack link in that
  channel.** That is correct behaviour and will be reported as a bug.
- **Read path.** Public views never touch the K8s API. Explain why caching does not substitute for the
  projection: ids are unguessable, so every probe is a distinct key and therefore a guaranteed miss.
  Document the three projection mechanisms and their one job each (lazy fill is the backfill; the
  reconcile refreshes existing rows only).

Also record that the usage-tracking `agents` table cannot serve this page, because its `owner_sub` is
hashed on write. Someone will find that table and think it is the obvious home.

### 2. `docs/architecture/channels.md`

- Update the footer bullet under "Inbound" and the "Injected history is attributed per Agent" bullet: the
  agent id in the URL is the wire format, the label is presentation, and attribution resolves names from
  ids rather than reading the label. State the invariant plainly, because the whole point of slice 03 was
  that a copy change silently broke a runtime feature.
- Record the new footer URL and label, and that legacy `/chat/` and `/sandboxes/` forms are still parsed.
- Note the renamed-agent behaviour change in injected history.
- Bump `Last verified:`.

### 3. `docs/architecture/persistence.md`

- Add `agent_public_profiles` to the Postgres section.
- Show it satisfying the page's own "Choosing between Postgres and the K8s API" rule: the controller does
  not reconcile it, only the api-server reads and writes it, and it must be queryable with no agent pod
  running.
- Call out the unhashed `owner_sub` against the hashed one in the usage mirror, so the difference reads as
  deliberate.
- Bump `Last verified:`.

### 4. Check for drift you introduced

Run `/doc-drift` against the branch and resolve anything it flags in the architecture tree.

Out of scope, found during design and worth filing separately rather than fixing here: the **Channel
Binding** glossary row still says "a surface may be bound to at most one Agent globally", but
`channels.md` documents bindings as many-to-many with a default agent per conversation.

## Acceptance criteria

- [ ] `docs/architecture/public-agent-page.md` exists, is linked from `docs/architecture.md`, and carries all four decisions with their rationale
- [ ] The accepted binding-release consequence is written down
- [ ] `channels.md` states the id-is-wire-format / label-is-presentation invariant and the new URL and label
- [ ] `persistence.md` covers the new table and justifies it against the Postgres-vs-K8s rule
- [ ] Both edited pages have a bumped `Last verified:` date
- [ ] No ADR is linked or referenced from any of these pages
- [ ] `/doc-drift` reports nothing outstanding for this branch
- [ ] `mise run check` passes, including prettier formatting of the Markdown

## Smoke test

```sh
mise run check
```

Then read `docs/architecture/public-agent-page.md` cold and ask whether it alone would stop a future
change from turning the projection back into a K8s read-through, or from moving the page to the share
host. If it would not, it is not finished.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
