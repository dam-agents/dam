# Analysis — `dam instances create` and template discovery (#188)

## 1. Scope

### In scope (this issue)

Four new CLI verbs:
- `dam instances create <name> --template <id> [--description <text>] [--env KEY=VAL ...] [--wait] [--timeout <seconds>] [--json]`
- `dam instances delete <ref> [--yes|-y] [--json]`
- `dam instances restart <ref> [--wait] [--timeout <seconds>] [--json]`
- `dam templates list [--json]`

Bundled adjustments (carved out from this design, not separate issues):
- **Existing-verb alignment**: replace `AGENT` column with `TEMPLATE` in `dam instances list`; replace `agentId` with `template` in `dam instances get`.
- **Server projection widening**: include `templateId` on the `Instance` view returned by `instances.list` and `instances.get`. Also surface `image` for `<custom>` cases (UI-created agents that use an image instead of a template).
- **Server typed error**: convert `throw new Error("Template ... not found")` in `agents-service.ts` to `throw new TRPCError({ code: "NOT_FOUND", message })`.
- **New CLI module**: `packages/cli/src/modules/templates/` as a top-level sibling of `instances/`, `auth/`, `cli/`.
- **Shared tRPC client**: lift `createInstancesTrpcClient` out of `instances/infrastructure/` into a shared location consumed by both `instances` and `templates` modules (and any future verbs).

### Out of scope (filed as follow-ups / belongs to other epics)

- **Provider secrets** (`secrets.setAgentAccess`) — epic 4.
- **App connections** (`connections.setAgentConnections`) — epic 4.
- **Egress preset** (`--egress-preset`) — epic 10.
- **`--env-file` flag** — defer to future create-ergonomics work.
- **`--ignore-not-found` flag** on delete — defer; shell `|| true` covers scripts.
- **`dam agents delete` for orphan cleanup** — defer; web UI handles orphans today.
- **Template-overridable egress defaults** — TemplateSpec has no egress field; server hardcodes `"trusted"`. Flag for epic 10.
- **Zod schema export refactor** — filed as [#195](https://github.com/dam-agents/dam/issues/195).

## 2. Lifecycle model

The CLI presents instances as single, atomic entities. Server-side reality (Agent ↔ Instance is 1:N) is hidden from the user.

**Create**: `dam instances create` issues `agents.create` + `instances.create` as a unit; the CLI guarantees 1:1 pairing because it never reuses an agent.

**Delete**: `dam instances delete` calls **`agents.delete(agentId)`** (NOT `instances.delete`). Kubernetes OwnerReferences cascade-delete the instance ConfigMap and PVCs. This mirrors the web UI exactly.

**Restart**: `dam instances restart` calls `instances.restart(id)` — pod-level, agent untouched, volumes preserved.

The `instances.delete` server route is retained but not used by the CLI; it exists for the legacy 1:N case the UI may reactivate.

## 3. Verb specifications

### 3.1 `dam instances create <name>`

**RPC sequence** (3 calls on happy path):
1. `templates.list` — validate `--template` matches an existing `id`. On miss: stderr *"unknown template `X`. Available: A, B, C."* using the in-hand list, exit 1.
2. `agents.create({ templateId, description?, env?: [...] })` — env and description go to the **agent** (matches UI convention so subsequent UI edits land in the expected place).
3. `instances.create({ name, agentId })` — name only; env/description NOT sent to the instance.

**Input handling:**
- `<name>` is **positional**, required. Matches `get`/`delete`/`restart`.
- `--template <id>` is required. Refers to template **ID** (the K8s ConfigMap name / slug), not the display name.
- `--env KEY=VAL` is repeatable; parsed by splitting on the first `=`. Key must match `[A-Za-z_][A-Za-z0-9_]*`. Empty value (`KEY=`) is valid; missing `=` is an error.
- `--description <text>` optional.
- `--wait` polls `instances.get` every 1–2 s until `state == "running"` or terminal `state == "error"`. Default timeout 120 s.

**Local pre-validation** (before any RPC): name non-empty, name does not start with `inst-`. Server schema remains source of truth for everything else.

**Output:**
- Default: `Created instance "foo" (inst-abc123). State: creating.` (or `State: running` after `--wait`).
- `--json`: full Instance object (post-create or post-wait), single JSON object.
- Progress lines during `--wait` go to **stderr**; stdout stays clean for piping.

**Rollback (instances.create fails after agents.create succeeded):**

| Failure | Rollback? |
|---|---|
| Typed `TRPCError` in `{CONFLICT, BAD_REQUEST, NOT_FOUND, UNAUTHORIZED, FORBIDDEN, PRECONDITION_FAILED}` | Yes (single attempt, 10s timeout) |
| `INTERNAL_SERVER_ERROR` or transport error | No — outcome ambiguous; report potential leak |
| `--wait` timeout or terminal `error` state | No — instance was created; user has agency to inspect |

If rollback succeeds: surface only the original error. If rollback fails: surface both errors plus orphan agent ID and pointer to manual cleanup.

### 3.2 `dam instances delete <ref>`

- **Ref** positional, accepts name or `inst-…` ID via existing `instance-resolver.ts`.
- **Confirmation prompt by default**: `Delete instance "foo"? This destroys all persistent data and cannot be undone. (y/N): `. Default `N`. `--yes`/`-y` skips.
- **Non-tty stdin without `--yes`** → error exit 2: *"delete requires confirmation; pass --yes or run interactively"*.
- **Implementation**: resolve ref → instance → `agentId`; call `agents.delete(agentId)`.
- **Output**: `Deleted instance "foo".` Or `Cancelled.` if user declined. `--json` returns `{ "deleted": true, "id": "inst-…", "name": "foo" }` (or `{ "cancelled": true }`).

### 3.3 `dam instances restart <ref>`

- **No confirmation prompt** — restart is reversible.
- **No state preflight** — let the server handle any state.
- **`--wait`**: same semantics as create's `--wait`. Add a **2 s grace period** before first poll so K8s has time to remove pod-0 before we observe state.
- **Output**: `Restarted instance "foo" (inst-abc123).` Plus `State: running.` with `--wait`. `--json` returns full Instance.

### 3.4 `dam templates list`

- No arguments, no filters.
- **Default table**:
  ```
  NAME            ID              DESCRIPTION
  claude-code     claude-code     Claude Code dev agent
  pi-agent        pi-agent        Pi coding agent with multi-LLM support
  ```
  Sorted alphabetical by NAME. Description truncated to 60 chars in table view.
- **Empty case**: stderr `"No templates."`, exit 0.
- **`--json`**: full payload `[{ id, name, image, description }, …]`.

## 4. Cross-cutting decisions

### 4.1 Exit codes (reuse existing `exit-codes.ts`)
- `0` SUCCESS — RPC ok (and `--wait` settled to running)
- `1` RUNTIME_FAILURE — transport, server error, `--wait` timeout/error
- `2` INVALID_INPUT — bad flags, missing positional, non-tty delete without `--yes`
- `5` NOT_RESOLVED — ref doesn't resolve to an instance

### 4.2 Output convention
- Human prose → stdout for results, stderr for progress and errors.
- `--json` outputs a single JSON value per command on stdout; prose suppressed.
- Empty-list messages go to stderr to keep `--json` (or piped) consumers clean.

### 4.3 Error-message policy
- **Local validation, auth, async readiness, unknown-template**: CLI crafts messages with full context.
- **Server CONFLICT / BAD_REQUEST**: surface server `message` verbatim.
- **Server NOT_FOUND beyond the resolver**: render as `"no instance named foo"`.

## 5. Module / code layout

```
packages/cli/src/modules/
├── auth/
├── cli/
├── instances/
│   ├── commands/
│   │   ├── list.ts          (modify: AGENT → TEMPLATE column)
│   │   ├── get.ts           (modify: agentId → template field)
│   │   ├── create.ts        (new)
│   │   ├── delete.ts        (new)
│   │   └── restart.ts       (new)
│   ├── services/
│   │   ├── instances-service.ts  (extend: create/delete/restart)
│   │   └── instance-resolver.ts  (reuse as-is)
│   └── compose.ts           (wire 3 new commands)
├── templates/                (new module)
│   ├── commands/list.ts
│   ├── services/templates-service.ts
│   └── compose.ts
└── shared/trpc/              (new, lifted from instances/infrastructure/)
    └── trpc-client.ts
```

Server changes:
- `packages/api-server-api/src/modules/instances/router.ts` — widen Instance projection to include `templateId` (and `image` when no template).
- `packages/api-server/src/modules/instances/services/instances-service.ts` — populate `templateId` in the returned view (lookup via the bound agent).
- `packages/api-server/src/modules/agents/services/agents-service.ts` — convert `throw new Error("Template ... not found")` to `throw new TRPCError({ code: "NOT_FOUND", message })`.

## 6. Open questions for the spec phase

These weren't grilled but the spec should resolve:

1. **Wait poll cadence**: 1 s vs 2 s between `instances.get` calls? Trade-off between responsiveness and server load.
2. **Progress output format during `--wait`**: single-line refresh (`\r`) vs multi-line append? Affects whether output works in non-tty environments without buffer weirdness.
3. **JSON output during `--wait`**: should progress emit nothing to stdout and only the final object, or stream state transitions as a JSON sequence? Recommend the former for v1.
4. **Restart in `--wait` mode**: how do we distinguish "restart in progress" from "always was running" if the state field doesn't transition? Currently solved with a 2 s grace period; spec should validate against reconciler timing.
5. **Help text shape**: agree on the standard help-text layout for the four new verbs so they read consistently.
6. **Test coverage**: which scenarios get integration tests against the live k3s cluster vs unit-only? Recommend integration coverage on create + delete (lifecycle), unit coverage on parsers/validators.

## 7. Findings flagged for other workstreams

- **Egress defaults are not template-overridable today.** Server hardcodes `"trusted"` when `egressPreset` is omitted. Epic 10 (network access) should add an `egress` field to `TemplateSpec` and have the service prefer it before falling back.
- **UI form schemas duplicate server validation.** Discussed in [#195](https://github.com/dam-agents/dam/issues/195).
- **Orphan agents leak via UI's custom-image path.** Out of scope for this issue but worth noting: UI can create agents without instances. The `<custom>` rendering in `list`/`get` is the user-visible accommodation.
