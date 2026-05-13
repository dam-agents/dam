# Implementation Spec — `dam instances create` and template discovery (#188)

Companion to [`188-instances-create.md`](188-instances-create.md). The analysis settled scope, lifecycle model, RPC sequencing, and error policy. This spec locks down the remaining decisions (UX conventions, file layout, test scope, wait semantics) so implementation can proceed without re-deciding mid-PR.

## 1. CLI UX conventions (locked)

These apply to all `dam` verbs — existing and future. After this spec lands they graduate to `docs/guidelines/cli-ux-guidelines.md` as a standalone doc. Future issues reference the guideline; this spec is the one-time alignment.

### 1.1 Descriptions
- **Commands and flags:** sentence case, **no trailing period**. Imperative voice ("list configured hosts", not "lists" or "list … hosts."). Single line.
- **Arguments** (`<ref>`, `<name>`): title-case noun phrase after an em-dash. Example: `<ref> — Instance Ref (name or 'inst-…')`.

### 1.2 Output destinations
- **stdout:** the primary result a user (or pipe consumer) cares about — table rows, the JSON payload, a one-line success summary.
- **stderr:** progress lines, warnings, errors, confirmation prompts, **empty-state messages**.
- `--json` suppresses all prose; a single JSON value goes to stdout, terminated by `\n`. Empty list is `[]`, never `null`.

### 1.3 Success-message format
- **State-changing verbs** (`create`, `delete`, `restart`, `login`, `logout`): `✓ <Past-tense verb> <noun> "<name>"` to stdout. Optional second clause for follow-up info, period-separated.
  - `✓ Created instance "foo" (inst-abc123). State: running.`
  - `✓ Deleted instance "foo".`
  - `✓ Restarted instance "foo" (inst-abc123). State: running.`
- **Config / pure-write verbs** (`dam config set`): plain prose, no checkmark — `wrote config: server=https://…`. (Matches existing `config-set.ts`; not changed.)
- Checkmark is a literal `✓` (U+2713), no color in v1.

### 1.4 Empty-state messages
- Pattern: `No <plural noun>.` to **stderr**, exit 0. Always include a period.
- Optional remediation hint on a second stderr line: `hint: <imperative>` (e.g. `hint: create one with 'dam instances create …'`).
- `--json` always outputs `[]` on stdout, regardless of TTY or remediation hints.

### 1.5 Error messages
- All errors go to stderr, prefixed `error: `, lowercase detail (one sentence, no trailing period).
- **Quoting:** backticks for IDs, flags, env vars, and shell tokens (`` `inst-abc123` ``, `` `--server` ``, `` `DAM_TOKEN` ``). Double quotes for user-supplied names and free-form values (`"foo"`).
- **Server-unreachable canonical form:** `cannot reach server `<host>`: <underlying-message>`.
- **Multi-line errors:** main error on first line; one remediation hint per subsequent line, each prefixed `hint: ` (no indentation). The `hint:` prefix replaces the current ad-hoc indent.

### 1.6 Flag conventions
- Long form for everything; short form only when industry-standard (`-h`, `-y`).
- `--server <url>` — first option in every networked verb's help.
- `--json` — last option, after all domain flags. Boolean, no short form.
- `--wait` boolean; `--timeout <seconds>` numeric, default 120. Used together.
- `--yes` / `-y` — skips confirmation. Only on destructive verbs.
- Repeatable flags (`--env KEY=VAL`) are accumulated in declaration order; later wins on duplicate keys.

### 1.7 Confirmation prompts (destructive verbs only)
- Pattern: `<sentence>. This <consequence>. (y/N): ` written to stderr; reads from stdin.
- Default = N. Case-insensitive match on `y`/`yes`.
- Non-tty stdin without `--yes` → exit 2 with `error: <verb> requires confirmation; pass `--yes` or run interactively`.

### 1.8 Tables
- Header row UPPERCASE, columns left-aligned, two spaces between columns.
- Truncate string columns at 60 chars (suffix `…`); never truncate IDs.
- Sort: alphabetical by primary name column unless otherwise specified.

### 1.9 Key:value blocks (used by `get`)
- Align values to `max(keyLen) + 2 spaces`. Update `get.ts` to compute padding instead of hardcoding 8.

### 1.10 Exit codes (reuses `exit-codes.ts`)

| Code | Meaning |
|------|---------|
| 0 | Success (and `--wait` settled to `running` where applicable) |
| 1 | Runtime failure (transport, server error, `--wait` timeout, terminal error state) |
| 2 | Invalid input (bad flag, missing positional, non-tty delete without `--yes`) |
| 3 | CLI below server compat floor |
| 5 | Ref didn't resolve (not-found OR ambiguous — single code as today) |

## 2. Pre-work (one-shot refactor, separate commit)

Before any new verb lands, refactor existing duplication. These changes are no-functional-difference and unblock clean implementation:

1. Extract `printCompatResolveError` and `describeConfigError` from `instances/commands/list.ts` and `instances/commands/get.ts` to a new `instances/commands/errors.ts`. Both call sites import from there.
2. Lift `createInstancesTrpcClient` from `instances/infrastructure/` to a new `shared/trpc/trpc-client.ts`. Rename to `createTrpcClient`. Both `instances` and the new `templates` module consume it.
3. Align existing strings to §1.5:
   - `list.ts` "cannot reach server …" → canonical form.
   - `get.ts` "no instance named 'foo'" → backtick the ref token style is already close; switch user-typed name to double quotes per §1.5.
   - Empty-state in `list.ts` ("No instances.") already on stderr — confirm; add the `hint:` line.

These are part of the same PR series as #188 but in a dedicated `refactor(cli): …` commit so the new-verb diffs stay readable.

## 3. Server changes

Per the analysis (§5):

1. **`packages/api-server-api/src/modules/instances/router.ts`** — widen the `Instance` Zod output schema:
   - Add `templateId: z.string().nullable()`.
   - Add `image: z.string().nullable()` (populated when an agent was created from a raw image rather than a template — the `<custom>` UI path).
2. **`packages/api-server/src/modules/instances/services/instances-service.ts`** — when building the `Instance` view in `list` / `get`, look up the bound agent and project both fields.
3. **`packages/api-server/src/modules/agents/services/agents-service.ts`** — replace `throw new Error("Template ... not found")` with `throw new TRPCError({ code: "NOT_FOUND", message: ... })`. This is the only typed-error change the four new verbs require to behave correctly on the unhappy paths.

No new tRPC routes. `templates.list`, `agents.create`, `agents.delete`, `instances.create`, `instances.restart`, `instances.get`, `instances.list` are all existing surface.

## 4. CLI implementation

### 4.1 Module layout

```
packages/cli/src/modules/
├── auth/                          (unchanged)
├── cli/                           (unchanged)
├── instances/
│   ├── commands/
│   │   ├── list.ts                MODIFY: AGENT col → TEMPLATE, use new shared errors
│   │   ├── get.ts                 MODIFY: agentId field → template + image, dynamic padding
│   │   ├── create.ts              NEW
│   │   ├── delete.ts              NEW
│   │   ├── restart.ts             NEW
│   │   └── errors.ts              NEW (extracted)
│   ├── services/
│   │   ├── instances-service.ts   EXTEND: create/delete/restart methods
│   │   └── instance-resolver.ts   (unchanged)
│   └── compose.ts                 MODIFY: wire create/delete/restart
├── templates/                     NEW MODULE
│   ├── commands/list.ts
│   ├── services/templates-service.ts
│   ├── compose.ts
│   └── index.ts
└── shared/
    └── trpc/
        └── trpc-client.ts         NEW (lifted from instances/infrastructure/)
```

`templates/` mirrors `instances/`'s structure (commands/services/compose/index) so the third domain module follows a recognized template.

### 4.2 `dam instances create <name>`

```
Usage: dam instances create <name> [options]

Arguments:
  <name>                    instance name (1+ chars, must not start with 'inst-')

Options:
  --server <url>            override the configured server URL
  --template <id>           template id (required; see 'dam templates list')
  --description <text>      free-form description
  --env <KEY=VAL>           env var (repeatable)
  --wait                    poll until state == 'running' (or terminal error)
  --timeout <seconds>       --wait timeout (default 120)
  --json                    emit raw Instance JSON
```

**Local validation (before any RPC):**
- `<name>` non-empty.
- `<name>` does not start with `inst-` (case-sensitive — matches server zod refinement).
- `--template` present and non-empty.
- Each `--env` matches `^[A-Za-z_][A-Za-z0-9_]*=.*$`. Splitting is on the **first** `=`; the value half may contain `=`. Empty value (`KEY=`) is valid; missing `=` is invalid → exit 2.

**RPC sequence:**
1. `templates.list()` — if `--template <id>` doesn't match any `id`, fail with `error: unknown template `<id>`. available: a, b, c.` to stderr, exit 2. (Local pre-check before any state-changing call.)
2. `agents.create({ templateId, description?, env? })` — env vars and description are attached to the **agent** (matches UI behavior so subsequent UI edits land in the expected place).
3. `instances.create({ name, agentId })` — name only.

**Rollback policy** (per analysis §3.1):

| `instances.create` outcome | Action |
|---|---|
| `TRPCError` in `{CONFLICT, BAD_REQUEST, NOT_FOUND, UNAUTHORIZED, FORBIDDEN, PRECONDITION_FAILED}` | Single rollback attempt: `agents.delete(agentId)` with 10 s timeout. Surface only the original error if rollback succeeds; surface both + orphan agent id if rollback fails. |
| `INTERNAL_SERVER_ERROR` / transport error | No rollback (outcome ambiguous). Surface error + agent id with cleanup hint. |

**Output:**
- Default: `✓ Created instance "foo" (inst-abc123). State: <state>.`
- `--wait` settled: `State: running.`
- `--json`: full `Instance` payload from `instances.get` (after wait if `--wait`), single object.

### 4.3 `dam instances delete <ref>`

```
Usage: dam instances delete <ref> [options]

Arguments:
  <ref>                     instance name or 'inst-…' ID

Options:
  --server <url>
  --yes, -y                 skip confirmation
  --json                    emit { deleted, id, name } or { cancelled: true }
```

- Resolve `<ref>` via existing `InstanceResolver`. On `not-found` / `ambiguous` → exit 5 with messages already established by `get.ts`.
- Prompt: `Delete instance "<name>"? This destroys all persistent data and cannot be undone. (y/N): ` to stderr.
- On `--yes` or affirmative response: call `agents.delete(instance.agentId)` (NOT `instances.delete` — see analysis §2). K8s OwnerReferences cascade-delete the instance ConfigMap and PVCs.
- On decline: stdout `Cancelled.`, exit 0. `--json` outputs `{ "cancelled": true }`.
- On non-tty stdin without `--yes`: exit 2 per §1.7.

**Output (success):** `✓ Deleted instance "<name>".`

### 4.4 `dam instances restart <ref>`

```
Usage: dam instances restart <ref> [options]

Options:
  --server <url>
  --wait                    poll until state == 'running'
  --timeout <seconds>       --wait timeout (default 120)
  --json                    emit raw Instance JSON
```

- No confirmation (reversible).
- No state preflight — let the server handle any state (including already-restarting).
- Implementation: resolve ref → `instances.restart(id)`. Server-side: delete pod-0; StatefulSet recreates it.

**Output:**
- Default (no `--wait`): `✓ Restarted instance "<name>" (inst-…).`
- `--wait`: `✓ Restarted instance "<name>" (inst-…). State: running.`

### 4.5 `dam templates list`

```
Usage: dam templates list [options]

Options:
  --server <url>
  --json
```

- Calls `templates.list()`.
- Default table:
  ```
  NAME           ID             DESCRIPTION
  claude-code    claude-code    Claude Code dev agent
  pi-agent       pi-agent       Pi coding agent with multi-LLM support
  ```
  Sort alphabetical by `NAME`. Description truncated at 60 chars per §1.8.
- Empty: stderr `No templates.`, exit 0. `--json`: `[]`.
- Full `--json` shape per item: `{ id, name, image, description }` (the existing payload).

### 4.6 `--wait` semantics (locked)

Applies to `create` and `restart`.

- **Poll cadence:** 2 s between calls. (Confirmed sufficient — instance creation settles in 5–15 s on the k3s rig; restart in 3–10 s.)
- **Restart grace period:** 2 s sleep **before the first poll** — gives the controller time to observe pod-0 deletion before we read `currentState`. Without this the first poll can see stale `running` state and exit prematurely.
- **Create has no grace period** — `instances.create` returns only after the ConfigMap exists, so the first poll always sees a real state.
- **Settle condition:** `currentState === "running" && podReady === true`. (Both fields needed — controller may write `currentState = "running"` before pod readiness probe passes; user-visible "ready" implies both.)
- **Terminal failure:** `currentState === "error"` → exit 1, surface `instance.error` field in stderr. Don't keep polling.
- **Timeout:** default 120 s. On timeout: print last observed state to stderr (`timed out waiting for "foo" to reach running (current: <state>)`), exit 1. The instance is left as-is — no rollback for wait timeout.
- **Progress output (default human mode):** append a line on **state change only**, not per poll. Example:
  ```
  Waiting for "foo"… state: creating
  state: starting
  state: running
  ```
  All progress lines to stderr. CI-safe (no `\r` tricks), terse, deterministic.
- **Progress output (`--json` mode):** suppressed entirely. Only the final `Instance` JSON object is emitted to stdout.

### 4.7 Help-text structure

Locked pattern, applied uniformly:

```
Usage: dam <noun> <verb> <args> [options]

[One-line description sentence in imperative voice, no trailing period]

Arguments:
  <arg>                     [description in lowercase, no period]

Options:
  --server <url>            [description]
  --<domain-flag> <value>   [description]
  --wait                    [description]
  --timeout <seconds>       [description]
  --yes, -y                 [description]
  --json                    [description]
  -h, --help                display help

Examples:
  dam <noun> <verb> ...     [one-line illustrative use]
  dam <noun> <verb> ...     [contrasting form]
```

`Examples:` is new — add at least two for each of the four new verbs. They go a long way for discoverability; commander.js supports them via `.addHelpText("after", …)`.

## 5. Test strategy

Selective — only tests that catch real regressions.

### 5.1 Integration tests (k3s, end-to-end)

Two scenarios, both exercise the full RPC chain:

1. **Lifecycle happy path:** `templates list` → `instances create --template <one> --wait` → `instances list` (verify present) → `instances get` (verify projection) → `instances restart --wait` → `instances delete --yes` → `instances list` (verify gone).
2. **Negative pre-check:** `instances create --template no-such-template` → exit 2, no agent or instance leaked (verify via direct k8s read).

That's it. Skip per-verb "creates an instance" tests — the lifecycle test covers them.

### 5.2 Unit tests

Only where there's real logic that can break independently of the API:

1. **`--env` parser** — `KEY=VAL` → `[KEY, VAL]`; `KEY=` → `[KEY, ""]`; `KEY` alone → error; `123KEY=foo` → error (bad key); `KEY=a=b=c` → `[KEY, "a=b=c"]` (split-on-first).
2. **Name validator** — empty → error; `inst-foo` → error; `foo` → ok; `instance-foo` → ok (only the literal `inst-` prefix is reserved).

Skip:
- Templates-list table rendering (trivial, breakage is visually obvious).
- Mock-the-tRPC-client unit tests for each verb — they re-test commander wiring without verifying behavior. The integration test is the source of truth.
- Confirmation-prompt unit tests — readline mocking provides no signal beyond "we wrote the readline code".
- Rollback unit tests — covered implicitly by the lifecycle integration test's cleanup phase; explicit unit tests for the rollback branch would mock so much they'd assert their own mocks.

### 5.3 Doc updates

After implementation:

- `docs/architecture/cli.md` — add a `## Instance lifecycle` section covering create/delete/restart and the agent-vs-instance split the CLI hides. Bump `Last verified:`.
- Promote §1 of this spec to `docs/guidelines/cli-ux-guidelines.md`. Cross-reference from `docs/architecture/cli.md`.
- `CHANGELOG` entry per repo convention (if any — verify before adding).

## 6. Implementation phases

The whole spec is one unit of work (#188). It ships as a sequence of **self-scoped sub-issues**, each landed and **smoke-tested** before the next one starts. No phase begins until the previous one's smoke test passes. Each phase is reviewable on its own and leaves the system in a working state.

### Phase 1 — Server: widen Instance projection + typed NOT_FOUND (§3)

**Changes:** Zod output schema gains `templateId` + `image`; `instances-service.ts` populates them; `agents-service.ts` throws typed `TRPCError({ code: "NOT_FOUND" })` for unknown templates.

**Why first:** The CLI refactor and the new verbs both rely on the new fields and the typed error. Landing the server side first means every downstream phase reads from a stable contract.

**Smoke test:**
- `mise run check` clean.
- `mise run cluster:install` (or upgrade); UI loads at `*.localhost:4444`.
- In the UI: existing instances render correctly in the agent list (no regression from the schema widen).
- `mise run cluster:kubectl -- exec deploy/api-server -- curl -s … instances.list` (or equivalent tRPC call) — payload includes `templateId` and `image` fields.
- Create an instance via the UI from a known template — `instances.get` returns `templateId` matching the template.
- Trigger the "unknown template" path (UI or direct tRPC): error surfaces as `TRPCError` with `code: "NOT_FOUND"`, not a bare `Error`.

### Phase 2 — CLI refactor + UX alignment (§2)

**Changes:** Extract `instances/commands/errors.ts`; lift `createInstancesTrpcClient` to `shared/trpc/`; align existing strings in `list.ts`, `get.ts`, `login.ts`, `logout.ts`, `ping.ts`, `config-set.ts`, `status.ts` to §1 conventions (canonical server-unreachable phrasing, backtick/quote rules, empty-state to stderr with `hint:`, dynamic key:value padding in `get`).

**Why second:** Locks the UX conventions in code before new verbs adopt them. Pure refactor + string changes — no behavior change beyond message wording.

**Smoke test:**
- `mise run check` clean.
- `dam instances list` against the cluster: table renders; empty case shows `No instances.` + `hint:` on stderr; `--json` still emits `[]`.
- `dam instances get <ref>`: key:value padding aligns to longest key; new `template` / `image` fields display (or `<custom>`).
- Force a server-unreachable error (stop api-server pod, run a verb): message matches `cannot reach server `<host>`: …`.
- Force an unknown-ref error: backticks on `inst-…`, double quotes on user-typed name.
- `dam auth login` / `logout` success messages still render as `✓ …` (unchanged but verify nothing regressed).

### Phase 3 — `dam templates list` + `dam instances create` (§4.2, §4.5)

**Changes:** New `templates/` module; `dam templates list` command; `dam instances create` command including `--wait`, `--env`, `--description`, rollback logic.

**Why third:** Largest single piece of functionality, but the prior phases mean it's purely additive — no edits to existing verbs needed.

**Smoke test (against `mise run cluster:install`):**
- `dam templates list` — shows `claude-code`, `pi-agent`, etc. `--json` returns the raw array.
- `dam instances create my-test --template claude-code --wait` — pod comes up, command prints `✓ Created instance "my-test" (inst-…). State: running.`
- `dam instances list` — `my-test` appears with `TEMPLATE = claude-code`.
- `dam instances get my-test` — shows `template: claude-code`.
- Negative: `dam instances create x --template no-such` — exits 2 with `unknown template `no-such`. available: …`; verify via `mise run cluster:kubectl -- get configmaps -l type=agent` that no orphan agent was created.
- Negative: `dam instances create my-test --template claude-code` (duplicate name) — exits 1, surfaces CONFLICT; verify no orphan agent.
- `--env FOO=bar --env BAZ=` — pod env confirms both values.
- `--json` happy path emits a single Instance object, no prose.

### Phase 4 — `dam instances delete` + `dam instances restart` (§4.3, §4.4)

**Changes:** Two destructive verbs; confirmation prompt for delete; 2 s grace period + state polling for restart with `--wait`.

**Why fourth:** Closes the lifecycle. Independent of templates/create except that the smoke test reuses instances created by phase 3.

**Smoke test:**
- `dam instances restart my-test --wait` — pod-0 is replaced; `kubectl get pod my-test-0` shows fresh `Age`; CLI prints `✓ Restarted … State: running.` and progress lines show state transition.
- `dam instances delete my-test` — prompt appears on stderr; type `y`; instance gone, ConfigMap + PVCs cascade-deleted (verify via `kubectl get cm,pvc -l agent-ref=…`).
- `dam instances delete my-test` (already gone) — exit 5 with not-resolved message.
- Non-tty: `echo "" | dam instances delete other-test` — exit 2, no deletion.
- `dam instances delete other-test --yes` — no prompt, deleted.
- `dam instances restart non-existent` — exit 5.

### Phase 5 — Docs (§5.3)

**Changes:** Add `## Instance lifecycle` section to [`docs/architecture/cli.md`](../architecture/cli.md); bump `Last verified:`. (CLI UX guidelines stay in this spec for now — promote to `docs/guidelines/` in a later cleanup.)

**Smoke test:** `mise run check`, manual read-through. No runtime check needed.

---

**Sub-issue creation note:** Each phase above should be filed as its own GitHub issue under #188 (or as a checklist on #188) so progress is trackable. Sub-issue body should: (a) link back to the relevant spec section, (b) restate the smoke-test checklist verbatim, (c) declare the previous phase as a blocker.

## 7. Items intentionally deferred

Repeated from the analysis for the spec reader's convenience — none of these are blockers:

- `--env-file` flag.
- `--ignore-not-found` on delete.
- `dam agents delete` (orphan cleanup).
- `--egress-preset` flag (waits on epic 10 to make egress template-overridable).
- Provider secrets / app connections in `create` (epic 4).
- Zod schema export refactor (#195).
- JSON-streamed progress during `--wait`.
- Per-host file locking for `auth.toml` (orthogonal, called out in `cli.md`).
