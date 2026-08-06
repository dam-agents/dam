# 01 — Preview a standalone or image-baked skill

**Part of:** Preview a skill's SKILL.md in-product — see [README](./README.md)

## Context

A Local Skill's name is inert: [`standalone-skill-row.tsx:91`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skill-row.tsx)
and [`built-in-skills-group.tsx:45`](../../../packages/ui/src/modules/sandboxes/components/skills/built-in-skills-group.tsx)
both render a plain `<p>`, so clicking a skill created in the sandbox does nothing. Everything
needed to fix that is already on the wire — `skills.readLocal` returns
`{ dir, files: [{ relPath, content, base64? }] }` and the UI already calls it for the download
action — so this slice is UI only: make the name a button, and give the render modal a
local-skill mode.

The obstacle is that [`skill-render-modal.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx)
is hard-coupled to a source: it takes `{ source: SkillSource, skill: Skill }`, always queries
`getSkillContent`, and derives a GitHub blob link from `source.gitUrl` + `skill.version`. A Local
Skill has no source and no version, so both the link accessory and the `dir` guess are
meaningless for it. Split the shell out rather than threading a discriminated union through one
component — the header, skeleton, and error markup stay in one place, and each mode owns only
its own query.

Apply the `/react-ui-engineering` skill.

## Implementation plan

Work inside `packages/ui/src/modules/sandboxes/components/skills/`.

### 1. Extract the modal shell — new `skill-markdown-modal.tsx`

A presentational component holding everything currently in `skill-render-modal.tsx` *except*
the query and the link derivation. No data fetching, no tRPC import.

Props: `{ title: string; description?: string | undefined; linkHref?: string | null;
isPending: boolean; isError: boolean; content?: string | undefined; onClose: () => void }`.

Move over verbatim: the `<Modal widthClass="w-[720px]">`, the `<DialogHeader>` with
`truncateTitle`, the `titleAccessory` (render the `<Launch>` anchor only when `linkHref` is
truthy — keep the existing `Tooltip`, `externalLinkProps`, and `aria-label`), the truncated
`subtitle`, the four-bar pulse skeleton, the error paragraph, and `<Markdown>{content}</Markdown>`.

The error paragraph currently appends "Open it on GitHub from the link above." conditionally on
`link`; that stays, keyed off `linkHref`, so the local mode (no link) shows only the first
sentence. Its wording — "An in-product preview isn't available for this skill yet" — is written
for the deferral this feature removes. Reword to describe a *failure*, e.g. "Couldn't load this
skill's SKILL.md.", since after slice 02 an error here means the read failed, not that the
feature is missing.

### 2. Point the source-backed modal at the shell

Keep `skill-render-modal.tsx`'s exported name `SkillRenderModal` and its current props
(`source`, `skill`, `agentId`, `onClose`) — `skills-surface.tsx` and the source card wire it
already. It keeps the `getSkillContent` query and the `dir` / `gitBlobUrl` derivation, and
returns `<SkillMarkdownModal …/>`.

Note the existing `dir` fallback comment says the guess is "the private-source fallback only —
there the scan comes from agent-runtime, which doesn't report `dir`". Slice 02 makes that
false. Leave the code alone here; slice 02 updates it.

### 3. New `local-skill-render-modal.tsx`

```tsx
export function LocalSkillRenderModal({
  skill, agentId, onClose,
}: { skill: LocalSkill; agentId: string; onClose: () => void })
```

- `useQuery(trpc.skills.readLocal.queryOptions({ agentId, name: skill.name }))` — `readLocal` is
  a query on the api-server router, so this mirrors how `SkillRenderModal` calls
  `getSkillContent.queryOptions`.
- Pick the manifest out of the payload: `data?.files.find((f) => f.relPath === "SKILL.md")`.
  Treat a missing entry (or one marked `base64`) as an error, not as empty content — every Local
  Skill has a `SKILL.md` by definition, so its absence means something is wrong rather than that
  there's nothing to show. `skill-download.ts:37` matches the same `relPath` literal.
- No `linkHref`: a Local Skill has no source and no blob URL. A published standalone skill has a
  PR URL, but that is the pull request, not this file — the row already links it.
- `agentId` is non-optional here: without a pod there is nothing to read. The caller only renders
  this modal when it has one (step 5).

Both `<Markdown>` and the frontmatter handling come free — `readLocal` returns the file's raw
text, frontmatter block included, exactly like `getSkillContent`.

### 4. Make both row types' names clickable

Copy the affordance from [`skill-row.tsx:53-65`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-row.tsx):
an optional `onOpen` prop; when present, render a `<button type="button">` with
`hover:underline` in place of the `<p>`, keeping `min-w-0 truncate text-left` so long names still
truncate; when absent, keep the `<p>`.

- `standalone-skill-row.tsx` — add `onOpen?: () => void`, apply to the name at line 91. Keep the
  description `<p>` untouched.
- `built-in-skills-group.tsx` — add `onOpen?: () => void` to the private `BuiltInSkillRow` and
  `onOpenSkill?: (skill: LocalSkill) => void` to the exported `BuiltInSkillsGroup`, threaded per
  row. Same button swap.
- `standalone-skills-group.tsx` — add `onOpenSkill: (skill: LocalSkill) => void` to the props and
  pass `onOpen={() => onOpenSkill(skill)}` on each `StandaloneSkillRow`.

Keep the prop optional on the row components so a caller without an `agentId` renders the inert
`<p>` instead of a button that can't work.

### 5. Wire it in `skills-surface.tsx`

- New state beside the existing `renderFor` (line 68):
  `const [localRenderFor, setLocalRenderFor] = useState<LocalSkill | null>(null)`.
- Pass `onOpenSkill` to `StandaloneSkillsGroup` (line 285) and `BuiltInSkillsGroup` (line 305),
  guarded on `agentId` the way `onManageConnections` already is: `agentId ? (skill) =>
  setLocalRenderFor(skill) : undefined`.
- Render beside the existing `SkillRenderModal` block (line 373):
  `{localRenderFor && agentId && (<LocalSkillRenderModal skill={localRenderFor} agentId={agentId}
  onClose={() => setLocalRenderFor(null)} />)}`.

**Don't add a `readOnly` guard.** When the sandbox is stopped or starting, the whole surface
already carries `pointer-events-none` plus a dimming opacity (`skills-surface.tsx:263-265`), so
the names are unclickable there by construction. A second guard would be dead code.

### 6. Finish

`mise run lint:fix`, then `mise run check`.

No architecture-doc change: `skills.md` § api-server skills service already documents the
**Read Local passthrough** this slice consumes, and nothing about the subsystem's structure
changes — only which UI element calls an existing endpoint.

## Acceptance criteria

- [ ] Clicking a skill name under **Created in this sandbox** opens a modal rendering its
      `SKILL.md` as markdown (frontmatter block included).
- [ ] Clicking a skill name under **Included with sandbox image** does the same.
- [ ] The local modal shows **no** GitHub link accessory; the public-source modal still shows its
      link, pointing at the same blob URL as before.
- [ ] A skill over the pod's 5 MB cap surfaces the modal's error state rather than an empty
      preview or an unhandled rejection.
- [ ] With the sandbox stopped, no skill name is clickable and nothing throws.
- [ ] `SkillRenderModal`'s public props are unchanged — its callers weren't touched.
- [ ] Header, skeleton, and error markup exist in exactly one place (`skill-markdown-modal.tsx`).
- [ ] `mise run check` passes.

## Smoke test

```bash
mise run check
```

Then manually, against the local dev cluster (`cluster-ops` skill; app at
**`http://localhost:4444`**, not https):

1. Open a running sandbox → Skills. If "Created in this sandbox" is empty, drop a small `.md`
   file on the panel to create one.
2. Click its name → the modal opens and renders the markdown. Confirm no `<Launch>` icon in the
   header.
3. Click a name under "Included with sandbox image" → same result.
4. Click a skill in a public GitHub source card → unchanged behavior, GitHub link still present
   and correct.
5. Stop the sandbox → the rows dim and no name responds to a click.

If a change appears not to apply, check the loaded bundle before debugging — the UI service
worker serves a stale one after a build.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
