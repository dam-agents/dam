# 01 — api-server: carry `scannedAt` through the scan cache and the `skills.list` contract

**Part of:** Show when a skill source was last scanned — see [README](./README.md)

## Context

Stamp the shared scan cache with the wall-clock time of each real upstream scan, then widen the
`skills.list` contract from a bare `Skill[]` to `{ skills, scannedAt }` so the UI (slice 02) can
render "scanned X ago". This is the backend half: cache field → service → tRPC contract, plus the
two non-UI callers of the widened service — the MCP tool and `getSkillContent`. No UI in this slice.

Apply the [`/typescript-engineering`](../../../.claude/skills) skill. **Base is `main`**, with
#3129 and #3139 both merged — the line numbers below were checked against that `main`, and the scan
cache is byte-identical to what step 1 describes. See the README's base-branch section.

## Implementation plan

Work outside-in from the cache. `scannedAt` is **epoch milliseconds** inside the cache (uniform
with `expiresAt`) and an **ISO-8601 string** on the wire (matching `publishedAt`); the service
converts ms → ISO at the one contract boundary.

### 1. Cache stamps `scannedAt` — [`compose.ts`](../../../packages/api-server/src/modules/skills/compose.ts)

- `interface CacheEntry` (line ~20): add `scannedAt: number;` alongside `skills` and `expiresAt`.
- `scanWithCache` (line ~39): widen the return type to
  `Promise<{ skills: Skill[]; scannedAt: number }>`.
  - **Hit:** `return { skills: hit.skills, scannedAt: hit.scannedAt };`
  - **Miss:** compute the timestamp once and reuse it for both fields —
    ```ts
    const scannedAt = Date.now();
    const skills = await scanner(gitUrl);
    sharedScanCache.set(key, { skills, expiresAt: scannedAt + CACHE_TTL_MS, scannedAt });
    return { skills, scannedAt };
    ```
  `invalidateScanCache` is unchanged (a delete, not a read).

### 2. Service return shape — [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)

- `SkillsServiceDeps.scanSource` (line ~73): widen its return type to
  `Promise<{ skills: Skill[]; scannedAt: number }>` (matches `scanWithCache`). Update the doc
  comment to note it now also reports when the scan happened.
- `list` (line ~342): **both** return sites currently `return await deps.scanSource(...)` — the
  public-GitHub path (~357) and the private/agent-runtime path (~380). Change each to destructure
  and convert to ISO:
  ```ts
  const { skills, scannedAt } = await deps.scanSource(src.gitUrl, src.path, /* scanner */);
  return { skills, scannedAt: new Date(scannedAt).toISOString() };
  ```
- `getSkillContent` (~line 411 on `main`): it calls `deps.scanSource(...)` to resolve the skill's
  `{version, dir}` from the shared cache. It currently binds
  `const skills = await deps.scanSource(...)`; change to `const { skills } = await deps.scanSource(...)`.
  The rest (`skills.find(...)`, the `dir` guard, `readPublicSkillFile`) is unchanged — it ignores
  `scannedAt`. **This is the third and last `scanSource` call site** (after `list`'s two paths);
  `grep -n "scanSource" skills-service.ts` should show exactly three, and missing this one fails
  `mise run check`.

### 3. Contract schema + type — api-server-api

- [`schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts): add a wrapper
  schema next to `skillSchema`. `scannedAt` is a **list-response** field, **not** a per-skill field
  — do **not** add it to `skillSchema`:
  ```ts
  /** A source's scanned skill list plus when that scan was read from upstream. */
  export const skillListResultSchema = z.object({
    skills: z.array(skillSchema),
    /** ISO 8601 time the source's skill list was last read from upstream. */
    scannedAt: z.string(),
  });
  ```
- [`types.ts`](../../../packages/api-server-api/src/modules/skills/types.ts): import
  `skillListResultSchema`, add `export type SkillListResult = z.infer<typeof skillListResultSchema>;`
  (follow the existing `z.infer` pattern), and change the `SkillsService.list` signature (line ~56)
  from `Promise<Skill[]>` to `Promise<SkillListResult>`.

### 4. Router output — [`router.ts`](../../../packages/api-server-api/src/modules/skills/router.ts)

- `list` procedure (line ~58): change `.output(z.array(skillSchema))` to
  `.output(skillListResultSchema)` and import it. The body (`return ctx.skills.list(...)`) is
  unchanged — it now returns the wrapper the schema validates.

### 5. MCP tool must keep emitting a bare array — [`mcp-endpoint.ts`](../../../packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts)

- `list_skills_in_source` (line ~525): its map fn is `(list) => JSON.stringify(list)`. With the
  widened return that would serialize `{ skills, scannedAt }` — an **agent-facing regression**
  invisible in the UI (the tool's description promises each skill's name/description/SHA). Change to
  `(result) => JSON.stringify(result.skills)` so agents keep receiving the array. The tool
  description needs no change (`scannedAt` is not surfaced to agents).

### 6. Architecture doc — [`skills.md`](../../architecture/skills.md)

- § api-server skills service, the **scan cache** bullet (line ~126): note the entry now records
  `scannedAt` (the time of the last real upstream read) and that `skills.list` carries it so the UI
  can show freshness.
- § Flows → **Listing & scan** (line ~237): note `skills.list` returns `{ skills, scannedAt }`;
  a cache hit reports the original scan time, a miss stamps the current one.
- Leave `Last verified:` at `2026-08-05` (already current on the #3129 base).

## Acceptance criteria

- [ ] `CacheEntry` carries `scannedAt`; `scanWithCache` stamps it on a miss and returns the cached
      value on a hit (a hit does not restamp).
- [ ] `skills.list` returns `{ skills, scannedAt }`; `scannedAt` is an ISO-8601 string.
- [ ] Every caller of the widened `scanSource` / `SkillsService.list` compiles: `list` (both paths)
      and `getSkillContent` destructure correctly.
- [ ] The MCP `list_skills_in_source` tool serializes `result.skills` — a bare JSON array, as before.
- [ ] `skills.md` scan-cache and Listing & scan mentions reflect `scannedAt`.
- [ ] No new test files (deliberate — see below). `mise run check` and `mise run test` pass.

## Smoke test

Backend-only, verifiable without the UI:

```bash
mise run check
```

`check` typechecks every package against the widened contract — the real safety net here. A missed
caller (the MCP tool or `getSkillContent`) is a compile error, not a silent runtime bug.

```bash
mise run test
```

The skills module ships **no** unit tests today (there is no `scanWithCache` harness to extend), so
this only confirms nothing elsewhere regressed. **No new test is added:** a cache-entry field plus a
serialization change is exercised end-to-end by `check` and the whole-feature smoke test, and the
owner's standing rule prefers removing redundant tests over adding tautological ones. This is the
deliberate call the README's Conventions section anticipates.

Optional live check (mint `DAM_TOKEN` via the password grant — see the `cli_smoke_auth` recipe):
call `skills.list` for a public GitHub source and confirm the response is
`{ skills: [...], scannedAt: "<ISO>" }` rather than a bare array.

The implementing agent runs `mise run check` + `mise run test` itself, then prints a short manual
guide for the optional live check.
