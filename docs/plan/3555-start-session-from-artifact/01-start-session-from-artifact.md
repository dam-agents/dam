# 01 — Start a new session from an artifact

**Part of:** Start a new session from an artifact — see [README](./README.md)

## Context

This slice is the whole feature: one action, exposed on three components, that
opens a new session on the Agent that published an artifact and leaves a
reference to that artifact in the composer. Read the README first — it holds the
reference format, the surfaces, the hiding rules, and the two constraints that
are already settled. Apply the `/react-ui-engineering` skill throughout;
everything below except step 6 is in `packages/ui`.

## Implementation plan

### 1. The prefill text (new file)

`packages/ui/src/modules/artifacts/lib/session-prefill.ts` — one exported pure
function that takes a `LibraryArtifact` and returns
`` `${artifact.title} — ${artifactInternalLink(artifact.id)}` ``.
`artifactInternalLink` comes from `api-server-api`. Use an em dash, as the
README's format shows.

### 2. The draft write (sessions slice)

`packages/ui/src/modules/sessions/store/sessions.ts` — add one action to
`SessionsSlice`: `appendNewSessionDraft(agentId: string, text: string): void`.

Implement it with the slice's existing `updateDrafts` helper, so persistence and
cross-tab sync come for free:

- The key is `draftKey(agentId, null)` — the Agent's blank new chat.
- If the current draft text is non-empty, the new text is joined after it with a
  blank line. Otherwise it is the whole text.
- Attachments on an existing draft are left untouched.

The join rule lives here, not in the artifacts module, because the draft key
shape and the draft writer belong to sessions.

### 3. The action hook (new file)

`packages/ui/src/modules/artifacts/hooks/use-start-artifact-session.ts` — one
exported hook, `useStartArtifactSession(artifact)`, accepting a
`LibraryArtifact` that may be absent (the docked panel resolves its artifact
through a query). It returns `{ available, start }`.

- Resolve the creating Agent with `useAgentsList()` from
  `modules/agents/api/queries.js`, matching `artifact.agentId`. One lookup
  serves both the guard and the knowledge-base branch. `available` is true only
  when that Agent object was found, which covers a null `agentId`, a deleted
  Agent, and the still-loading list in one condition.
- `start` appends the prefill through the new slice action, then navigates:
  `openKnowledgeBase(agent.id)` when `isKnowledgeBase(agent)`
  (`modules/agents/utils/agent-kind.js`), otherwise `selectAgent(agent.id)`.
  Then `setMobileScreen("chat")`, because `selectAgent` lands on the session
  list.
- Do not add a discard guard. Navigation clears `openArtifactId`, which closes
  the docked panel, and the call sites hide the action while an editor is open,
  so no unsaved edit can be lost through this path.

### 4. The menu item

`packages/ui/src/modules/artifacts/components/artifact-row-menu-items.tsx` —
call the hook, and when `available`, render a `DropdownMenuItem` labelled
`Start a new session` after the Download item and above the
`DropdownMenuSeparator`. This one edit covers the artifacts page rows, the
Agent's artifacts section on sandbox home, and the chat sidebar list, because
all three render this component.

### 5. The two preview surfaces

`artifact-preview-dialog.tsx` — append a third `DialogFooter` button after
Download: default variant (the primary black one), `Launch` icon at size 16,
label `Start a new session`. The footer right-aligns its children, so appending
puts it rightmost as the design shows. Render it only when `available`, the
displayed version is head, and `editor.editing` is false.

`docked-artifact-panel.tsx` — in the non-editing branch of the toolbar, after
the Download button, add an icon-only button: `variant="outline"`,
`size="icon-xs"`, `Launch` icon at size 14, plus `aria-label` and `tooltip` of
`Start a new session`. Same conditions: `available` and the shown version is
the latest.

`Launch` is already imported from `@carbon/icons-react` elsewhere in the UI
(`sandboxes/components/open-in-dialogs.tsx`).

### 6. Teach the tool the reference (api-server)

`packages/api-server/src/modules/artifact-library/mcp-tools.ts` — extend the
`get_artifact` description with one sentence saying that a reference of the form
`platform://artifacts/<id>` names an artifact, and that the `<id>` part is what
this tool's `id` argument takes. The tool already returns `internal_link` in
that form; this closes the loop for an Agent that receives one in a prompt.

### 7. The architecture page

`docs/architecture/artifact-library.md` — add the continuation path to the
attribution discussion in durable terms: an artifact's Agent attribution is
also what lets a user continue it, by opening a new session on the publishing
Agent with the artifact's internal reference pre-filled in the composer, unsent.
Note that uploads have no publishing Agent and so offer no continuation. Bump
`Last verified` to the day of the commit. Keep it to a few sentences; no file
paths, no component names, no ADR links.

## Acceptance criteria

- [ ] `Start a new session` appears in the artifact overflow menu on the
      artifacts page, on the Agent's artifacts section, and in the chat sidebar
      list — after Download, above the separator.
- [ ] The artifact preview dialog shows a primary `Start a new session` button
      as the rightmost footer action.
- [ ] The docked artifact panel shows an icon-only button with a
      `Start a new session` tooltip beside Download.
- [ ] All three affordances are absent for an uploaded artifact (no creating
      Agent) and for an artifact whose creating Agent is not in the Agent list.
- [ ] Both preview affordances are absent while an older version is displayed
      and while the source editor is open. The menu item stays in both cases.
- [ ] Clicking any of them opens the creating Agent's chat on a blank session,
      with the composer holding `<title> — platform://artifacts/<id>`. A
      knowledge base opens its own chat view.
- [ ] Unsent text already in that Agent's new chat is kept, and the reference is
      appended after a blank line.
- [ ] Nothing is sent until the user presses send.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test`,
      `mise run //packages/api-server:check` and
      `mise run check:comment-types` all pass.
- [ ] `docs/architecture/artifact-library.md` describes the continuation path
      and carries a bumped `Last verified` date.

## Smoke test

Existing checks, no new tests:

```bash
mise run //packages/ui:check && mise run //packages/ui:test && mise run //packages/api-server:check && mise run check:comment-types
```

Then, manually, on the dev cluster:

```bash
mise run cluster:build-ui && mise run cluster:build-apiserver
```

Open the app at `http://localhost:4444` (http, not https) and, on an artifact
that an Agent published:

1. From the artifacts page, open its ⋮ menu and choose `Start a new session`.
   The creating Agent's chat opens on a blank session, and the composer holds
   `<title> — platform://artifacts/<id>`. Nothing is sent.
2. Go back, click the row to open the preview dialog, and use the footer button.
   Same result. If the artifact has more than one version, flip to an older one
   and confirm the button disappears.
3. In a chat, open an artifact into the docked panel and use the toolbar icon
   button. Same result.
4. Type some text in an Agent's new chat first, then start a session from an
   artifact of that same Agent, and confirm your text is still there with the
   reference appended below it.
5. Confirm an uploaded artifact (the `you` creator chip) offers none of the
   three affordances.
6. Send the pre-filled message once. The Agent reads the artifact back through
   `get_artifact` rather than asking which artifact you mean.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
