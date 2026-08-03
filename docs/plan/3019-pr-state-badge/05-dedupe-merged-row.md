# 05 — Expose the local content hash and de-duplicate the merged row

**Depends on:** 01-record-pr-state
**Part of:** #3019 — see [README](./README.md)

## Context

After a pull request merges, the same skill appears twice on the Skills page: as a local creation
under "Created in this sandbox", and as an uninstalled entry under its source. The second one's
toggle reads **off** while the file is on the PVC and being loaded by the harness — so the page
asserts both "this exists and works" and "this is not installed" about one file.

That duplicate is the system's mess, not the user's, so this slice removes it with no user
involvement and no consent required. Handing governance to the source is a separate, deliberate act
and lives in slice 06.

De-duplicating correctly needs to know whether the local copy still matches upstream — if the user
edited it after publishing, the two rows really are different content and showing both is right. So
this slice also exposes the local content hash, which does not exist in the contract today.

Apply the `/typescript-engineering` skill (runtime + api-server) and `/react-ui-engineering` (the
UI change).

## Implementation plan

### 1. Expose the local content hash — lazily

`hashSkillDir` already exists at
[`local-skill-repository.ts:523`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts:523),
but the listing only calls it when a **pristine counterpart exists**
([line 260](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts:260)) —
which for user-authored skills, the only publishable kind, is never. So the hash is not currently
computed for the skills that matter.

Hashing every local dir on every `listLocal` is not acceptable: `listLocal` runs on **every**
`getState` poll while the sandbox is running, and the PVC is NFS-backed. So hash **on request**.

Add an optional input to `listLocal`
([`router.ts:93`](../../../packages/agent-runtime-api/src/modules/skills/router.ts:93)):

```ts
listLocal: protectedProcedure
  .input(skillListLocalInputSchema.optional())
  .query(…)
```

```ts
/** Names to compute `contentHash` for. Hashing walks the whole skill dir on an
 *  NFS-backed PVC and this runs on every state poll, so the caller asks only
 *  for the few skills it needs it for (#3019). */
export const skillListLocalInputSchema = z.object({
  hashNames: z.array(z.string()).optional(),
});
```

Add `contentHash: z.string().optional()` to `localSkillSchema` in **both** contract packages
(`api-server-api` and `agent-runtime-api`) — optional, because it is present only for requested
names and absent on pods predating this change.

Keep the input optional so existing callers are untouched.

In the api-server, `getState`
([`skills-service.ts:639`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:639))
computes the name list before calling `listLocal`: the skill names that have a publish record with
`prState === "merged"`. Usually zero or one, so the added I/O is negligible — and it is zero for
every sandbox that has never published.

### 2. Compare against upstream

The upstream hash comes from the source scan, which already carries `contentHash` per scanned skill.

The two hash implementations —
[`hashSkillDir`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts:523)
and
[`computeContentHash`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:107) —
are **algorithmically identical**: same recursive walk skipping dotfiles, same sort, same
`rel` + NUL + body + NUL feed, same SHA-256. So the values are directly comparable.

They are duplicated code. Do **not** "unify" or tidy either one in this slice: stored
`agent_skills.contentHash` values were produced by them, so any change mass-triggers phantom drift
on every installed skill everywhere. Add a comment on each pointing at the other so the coupling is
discoverable.

### 3. Suppress the duplicate

In [`skills-surface.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx),
where the per-source skill lists are assembled for `SkillsSourceGroup`, drop a scanned skill when
**all** of:

- a standalone skill of the same name exists, **and**
- it has a publish record for **this** source with `prState === "merged"`, **and**
- `standalone.contentHash === scanned.contentHash`.

All three matter. Name alone would hide an unrelated same-named catalog skill. Without the merged
check, an unrelated coincidence suppresses a real entry. Without the hash, a locally edited copy
hides the genuinely different upstream version.

Derive it as a `useMemo`'d predicate beside the existing `createdHere` / `builtIn` splits rather
than filtering inside JSX.

Leave the source's `N of M on` count reflecting what it actually scanned — the count describes the
source, not what this page chose to render.

### 4. Fix and check

```bash
mise run ui:fix && mise run check
```

## Acceptance criteria

- [ ] `listLocal` accepts an optional `{ hashNames }` and computes `contentHash` only for those names;
      omitting the input changes nothing.
- [ ] `localSkillSchema` carries optional `contentHash` in **both** contract packages.
- [ ] `getState` requests hashes only for skills with a `merged` publish record — zero requests for a
      sandbox that never published.
- [ ] A merged, unmodified skill appears **once** on the page: under "Created in this sandbox", with
      no entry under its source.
- [ ] A merged but **locally modified** skill appears **twice** — the local copy and the genuinely
      different upstream entry.
- [ ] A same-named skill in a source with **no** merged record for it is never suppressed.
- [ ] The source header's `N of M` count is unchanged by suppression.
- [ ] Neither hash implementation is modified.
- [ ] `mise run check` and `mise run test` pass, with no new test files.

## Smoke test

```bash
mise run check && mise run test
```

Then against the local cluster (`cluster-ops` skill), with a **public** source so state resolves
without a warm pod.

1. `mise run cluster:build-apiserver && mise run cluster:build-agent`, then confirm with
   `mise run cluster:status` that the api-server pod is the new one (`build-agent` can roll it back).
2. Publish a skill and **merge** the pull request. Wait for `pr_state = 'merged'`, then trigger a
   rescan of the source so the merged skill is in its listing.
3. Reload Skills. The skill must appear **once**, under "Created in this sandbox", with a
   `Published · {source}` pill and **no** entry under the source group.
4. Now edit the local copy so it diverges:
   ```bash
   mise run cluster:kubectl -- exec -n platform-agents <agent-pod> -c agent -- sh -c 'echo "local edit" >> /home/agent/.agents/skills/<name>/SKILL.md'
   ```
   Reload. Both rows must now appear — the hashes differ, so they are genuinely different content.
5. Confirm no false suppression: a source skill whose name matches nothing standalone still lists.

Step 4 is the discriminating case; a de-dupe that keys on name alone passes step 3 and fails here.

The implementing agent runs this itself, then prints a short manual guide for steps 3–5.
