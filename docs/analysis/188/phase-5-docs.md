# Phase 5 — Docs

**Issue:** [#188](https://github.com/dam-agents/dam/issues/188), Phase 5 of 5
**Blocks:** Nothing — final phase.
**Prerequisites:** [Phases 1–4](README.md) done and smoke-tested. The four new verbs (`dam templates list`, `dam instances create`, `dam instances delete`, `dam instances restart`) are functional and merged.

## Goal

Update [`docs/architecture/cli.md`](../../architecture/cli.md) so a reader who joins the project after this issue lands understands the full CLI surface. No new docs files in this phase — the CLI UX conventions stay in [the spec](../188-instances-create-spec.md#1-cli-ux-conventions-locked) for now (graduating to `docs/guidelines/cli-ux-guidelines.md` is a separate follow-up issue).

## Background (what you need to know)

The project has explicit [documentation guidelines](../../guidelines/documentation-guidelines.md). Re-read them before editing — the rules below summarize, but the guidelines are the source of truth.

Key points:

- [`docs/architecture/cli.md`](../../architecture/cli.md) explains the **why** behind the CLI's shape. It links to ADRs (motivation), the api-server contract, and other architecture pages.
- Every architecture page has a `Last verified: YYYY-MM-DD` line near the top. **Bump it** whenever the page is materially edited.
- "Motivated by" is a bulleted list of ADRs and prior issues that drove the current shape. Add #188 to that list if relevant motivation lands here.
- Don't paste implementation details (file paths, function names) into architecture pages — those rot. Architecture explains concepts; code is the source of truth for "how".
- Cross-link related pages (`[agent-lifecycle.md](agent-lifecycle.md)`, etc.) but don't summarize them.

## Concrete changes

### 5.1 Bump `Last verified:`

[`docs/architecture/cli.md`](../../architecture/cli.md) line 3 currently reads:

```
Last verified: 2026-05-12
```

Change to today's date (the date the Phase 5 PR is merged).

### 5.2 Update the overview paragraph

Current text ([`cli.md:12`](../../architecture/cli.md)) enumerates the surface:

> The current surface: `dam --version`, `dam --help` (built-in flags), `dam config set`, `dam ping`, `dam version`, the `dam auth login` / `dam auth logout` / `dam auth status` verbs added by [#80](https://github.com/dam-agents/dam/issues/80), and `dam instances list` / `dam instances get` added by [#81](https://github.com/dam-agents/dam/issues/81). Future verbs — `dam shell`, `dam import` — slot into their own modules…

Update to include the four new verbs and #188 as their source:

> The current surface: `dam --version`, `dam --help` (built-in flags), `dam config set`, `dam ping`, `dam version`, the `dam auth login` / `dam auth logout` / `dam auth status` verbs added by [#80](https://github.com/dam-agents/dam/issues/80), `dam instances list` / `dam instances get` added by [#81](https://github.com/dam-agents/dam/issues/81), and `dam instances create` / `dam instances delete` / `dam instances restart` / `dam templates list` added by [#188](https://github.com/dam-agents/dam/issues/188). Future verbs — `dam shell`, `dam import` — slot into their own modules…

### 5.3 Add a new section: `## Instance lifecycle`

Slot this between the existing `## Instance addressing` section and whatever follows. It explains the **CLI model**: a user creates, restarts, and deletes "instances" without seeing the agent-vs-instance split.

```markdown
## Instance lifecycle

The CLI presents Instances as single, atomic entities. The server-side Agent ↔ Instance 1:N split (an Agent is a template-bound desired spec; an Instance is a running pod derived from one) is intentionally hidden — `dam instances create` orchestrates the agent and the instance as a pair, and `dam instances delete` cascades through the Agent so the same OwnerReferences the web UI relies on clean up the instance and its PVCs.

- **Create** issues `agents.create` followed by `instances.create` as a single user-facing action. Env vars and description attach to the **agent** (matching UI behavior, so subsequent UI edits land where the user expects). If `instances.create` fails with a typed `TRPCError`, the CLI attempts a single 10-second rollback of the agent so partial failures don't leak orphans; untyped failures leave the agent and surface a hint pointing at the orphan.
- **Delete** calls `agents.delete(agentId)`. The Kubernetes garbage collector cascades through to the Instance ConfigMap and any owned PVCs. The legacy `instances.delete` server route is not used by the CLI; it exists for the 1:N case the UI may reactivate.
- **Restart** calls `instances.restart(id)`, which deletes pod-0 of the StatefulSet. The controller recreates the pod with the current spec; persistent volumes survive.
- **`--wait`** on `create` and `restart` polls `instances.get` every 2 seconds and settles on `state === "running"` (success) or `state === "error"` (terminal). `restart --wait` sleeps 2 seconds before the first poll so the controller has time to observe the pod deletion — otherwise the first poll might see stale `running` state from the old pod. Default timeout is 120 seconds; on timeout the instance is left as-is (no rollback) and the command exits non-zero.

`dam templates list` exposes the agent templates the operator has installed on the active host (the `claude-code`, `pi-agent`, etc. ConfigMaps the controller reads at boot). Templates are read-only from the CLI's perspective; operators add or remove them via Helm.
```

### 5.4 Refresh the "Motivated by" list

If #188 represents new motivation (it does — the lifecycle verbs were the missing piece of the developer-CLI golden path), add a bullet to the `## Motivated by` list at the top of `cli.md`:

```markdown
- [#188 — `dam instances create` and template discovery](https://github.com/dam-agents/dam/issues/188) — added the create/delete/restart lifecycle verbs and `templates list`, closing the loop on the "install CLI → set up agent → use agent" demo story.
```

### 5.5 Confirm no stale references elsewhere

Run the following greps and fix anything they surface:

```sh
grep -rn "dam instances list\|dam instances get" docs/
grep -rn "instances create\|instances delete\|instances restart\|templates list" docs/
```

If any other architecture page or guideline mentions the CLI's surface in a way that contradicts the new verbs, update the mention to match (or open a follow-up issue if the page is out of scope for #188).

### 5.6 What does NOT change in this phase

- **No new files.** Specifically, do not create `docs/guidelines/cli-ux-guidelines.md` — that promotion is a separate follow-up. The conventions live in [the spec](../188-instances-create-spec.md#1-cli-ux-conventions-locked) until then.
- **No ADR.** This issue implements a feature against an existing architecture (ADR-039 — Platform CLI foundation). It does not introduce a new architectural decision.
- **No CHANGELOG.** The repo has no conventional CHANGELOG file ([verified by listing `docs/` and the repo root](../../../) — if a `CHANGELOG.md` appears later, defer to its convention; do not create one here).

## Tests

None. Documentation only.

## Verification (smoke test)

1. **Lint clean:**
   ```sh
   mise run check
   ```
   This runs markdown linters and other doc validators if configured. Any failures must be resolved.

2. **Read the rendered page** locally (any markdown viewer, or `mise run` whatever-renders-docs if a task exists). Verify:
   - `Last verified:` is today's date.
   - The overview paragraph lists all four new verbs and links to #188.
   - The new `## Instance lifecycle` section is present, well-formed, and explains the agent-vs-instance hiding without leaking implementation details.
   - All inline links (`[…](…)`) resolve (no 404 on relative paths like `../adrs/039-cli-foundation.md`).

3. **Grep audit:**
   ```sh
   grep -rn "Last verified" docs/architecture/cli.md
   grep -rn "instances create" docs/architecture/cli.md
   grep -rn "Instance lifecycle" docs/architecture/cli.md
   ```
   The first must show today's date; the second and third must each return at least one hit.

4. **Cross-reference check:**
   ```sh
   grep -rn "188" docs/architecture/
   ```
   `cli.md` is the page that should reference #188. No other architecture page needs an edit for this issue.

5. **Doc-drift sanity:** Skim [`docs/architecture/agent-lifecycle.md`](../../architecture/agent-lifecycle.md). If it discusses how agents and instances are created in a way that conflicts with the new CLI lifecycle semantics (e.g. says "agents are created via the web UI only"), update it — but most likely it's already accurate since the CLI now mirrors the UI's create flow exactly.

If any step surfaces an issue, fix and re-verify before declaring Phase 5 done.

## Out of scope

- Promoting CLI UX conventions to `docs/guidelines/cli-ux-guidelines.md` — separate follow-up.
- A new ADR — no architectural decision introduced.
- API reference docs (e.g. man pages, generated CLI reference) — the in-CLI `--help` is the source of truth.
- Demo videos / GIFs.

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Spec — §5.3 doc updates](../188-instances-create-spec.md#53-doc-updates)
- [Documentation guidelines](../../guidelines/documentation-guidelines.md)
- [Architecture — CLI](../../architecture/cli.md) (the file you'll edit)
- [Architecture — Agent lifecycle](../../architecture/agent-lifecycle.md) (cross-reference target)
