# Phase 3 — `dam templates list` + `dam instances create`

**Issue:** [#188](https://github.com/dam-agents/dam/issues/188), Phase 3 of 5
**Blocks:** Phase 4
**Prerequisites:** [Phase 1](phase-1-server.md) + [Phase 2](phase-2-cli-refactor.md) done and smoke-tested.

## Goal

Ship two of the four new verbs:

- `dam templates list` — discover available agent templates on the active host.
- `dam instances create <name> --template <id>` — create an instance (orchestrating the agent + instance pair, with `--wait`, `--env`, `--description`, and rollback on partial failure).

Phase 4 will add `delete` and `restart`.

## Background (what you need to know)

### Lifecycle model (the CLI hides the agent-vs-instance split)

The server has a 1:N Agent → Instance relationship: an Agent is a desired template-bound pod spec; an Instance is a running pod derived from that agent. The web UI exposes both. The CLI deliberately hides this — to a CLI user there is just "an instance" with a name, a template, and a state.

`dam instances create` issues **two** tRPC mutations sequentially: `agents.create` then `instances.create`. The CLI ensures 1:1 pairing because it never reuses an agent. The deferred follow-ups (provider secrets, app connections, egress preset) that the web UI also wires at create-time are intentionally not part of this issue — see §"Out of scope" below.

### Relevant existing surface

**tRPC routes (already exist; do not modify):**

- `templates.list` — input: none. Output: `Array<{ id, name, image, description }>`. See [`templates/router.ts`](../../../packages/api-server-api/src/modules/templates/router.ts).
- `agents.create` — input: `{ name, templateId?, image?, description?, env?, egressPreset? }`. Either `templateId` or `image` is required (server enforces). Output: `{ id, name, templateId, image, description, env }`. See [`agents/router.ts`](../../../packages/api-server-api/src/modules/agents/router.ts).
- `agents.delete` — input: `{ id }`. Output: void. K8s OwnerReferences cascade-delete owned instances.
- `instances.create` — input: `{ name, agentId, env?, secretRef?, description?, allowedUserEmails? }`. Output: `Instance`. Name **must not** start with `inst-` (server enforces via Zod refinement). See [`instances/router.ts`](../../../packages/api-server-api/src/modules/instances/router.ts).
- `instances.get` — input: `{ id }`. Output: `Instance` (now includes `templateId` and `image` after Phase 1).

**Env var contract:** [`agents/router.ts`](../../../packages/api-server-api/src/modules/agents/router.ts) line 19 — name must match `[A-Z_][A-Z0-9_]*` (`ENV_NAME_RE`); value max 10000 chars; max 64 entries.

**Server name uniqueness:** `instances.create` already enforces per-owner unique names ([instances-service.ts:107–112](../../../packages/api-server/src/modules/instances/services/instances-service.ts)) and throws `TRPCError({ code: "CONFLICT" })`. No CLI pre-check needed; the server is the source of truth.

**State transitions an `Instance` exposes** (from [instances/types.ts:20](../../../packages/api-server-api/src/modules/instances/types.ts)): `"starting" | "running" | "hibernating" | "hibernated" | "error"`. The CLI `--wait` polls until `state === "running"` (success) or `state === "error"` (terminal failure).

### UX conventions (locked in Phase 2)

Skim [spec §1](../188-instances-create-spec.md#1-cli-ux-conventions-locked) if you haven't. The relevant points for this phase:

- **Success** for state-changing verbs: `✓ <Past-tense verb> <noun> "<name>" (<id>)`. Optional second clause separated by `. `.
- **Errors** to stderr, lowercase, prefixed `error: `, backticks on IDs/flags/env vars, double quotes on user names.
- **Empty state** to stderr.
- **`--json`** suppresses prose; single JSON value on stdout.
- **Help text** sentence case, no trailing period, with at least two `Examples:` per verb.
- **Exit codes:** 0 success, 1 runtime failure, 2 invalid input, 3 below floor, 5 not-resolved. The codes live in [`instances/commands/exit-codes.ts`](../../../packages/cli/src/modules/instances/commands/exit-codes.ts).

## Concrete changes

### 3.1 New `templates` module

Mirror the existing `instances` module's structure.

**Create these files:**

```
packages/cli/src/modules/templates/
├── commands/
│   ├── exit-codes.ts
│   └── list.ts
├── domain/
│   └── errors.ts            # re-uses TransportError / AuthRequiredError shapes from instances/domain/errors.ts
├── services/
│   └── templates-service.ts
├── compose.ts
└── index.ts
```

**`exit-codes.ts`** — copy the pattern from [`instances/commands/exit-codes.ts`](../../../packages/cli/src/modules/instances/commands/exit-codes.ts):

```ts
export const EXIT_TEMPLATES_SUCCESS = 0;
export const EXIT_TEMPLATES_RUNTIME_FAILURE = 1;
export const EXIT_TEMPLATES_INVALID_INPUT = 2;
export const EXIT_TEMPLATES_BELOW_FLOOR = 3;
```

**`services/templates-service.ts`** — port over the api-server's `templates.list` route. Use `TrpcClient` from `shared/trpc/trpc-client.ts` (lifted in Phase 2):

```ts
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { AuthRequiredAtTransportError } from "../../shared/trpc/trpc-client.js";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../instances/domain/errors.js";

export interface Template {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export interface TemplatesService {
  list(): Promise<Result<readonly Template[], TransportError | AuthRequiredError>>;
}

export function createTemplatesService(deps: { trpc: TrpcClient }): TemplatesService {
  return {
    async list() {
      try {
        const value = await deps.trpc.templates.list.query();
        return ok(value as readonly Template[]);
      } catch (e) {
        const sentinel = findAuthSentinel(e);
        if (sentinel) return err({ kind: "auth-required", reason: sentinel.message });
        return err({ kind: "transport", reason: errorReason(e) });
      }
    },
  };
}

function findAuthSentinel(e: unknown): AuthRequiredAtTransportError | null {
  let cursor: unknown = e;
  let depth = 0;
  while (cursor && depth < 8) {
    if (cursor instanceof AuthRequiredAtTransportError) return cursor;
    cursor = (cursor as { cause?: unknown }).cause;
    depth++;
  }
  return null;
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown transport failure";
}
```

Reusing the auth sentinel pattern from [`instances/services/instances-service.ts`](../../../packages/cli/src/modules/instances/services/instances-service.ts) is intentional: same wire contract, same classification. Don't extract this to a shared helper yet — wait until a third consumer needs it.

**`commands/list.ts`** — model after [`instances/commands/list.ts`](../../../packages/cli/src/modules/instances/commands/list.ts) (post Phase 2). Render the table with three columns:

```
NAME           ID             DESCRIPTION
claude-code    claude-code    Claude Code dev agent
pi-agent       pi-agent       Pi coding agent with multi-LLM support
```

- Sort alphabetical by `NAME`.
- Truncate `DESCRIPTION` at 60 chars (suffix `…`); never truncate ID.
- Empty-state: stderr `No templates.` + `hint: ask your operator to add one to the cluster` (one stderr write per line), exit 0.
- `--json`: full payload (array of `{ id, name, image, description }`), single line + `\n` to stdout.
- Reuse `printCompatResolveError` and `formatTransportError` from `instances/commands/errors.ts` (Phase 2 extracted them) — yes, the `templates` module imports from the `instances` module's errors helper. This is fine; it's a CLI-internal seam. If it grates, leave a `// TODO: lift to shared/cli-errors when a third caller appears` comment.

Help text (commander `.description()` + `.addHelpText("after", …)`):

```
Usage: dam templates list [options]

List agent templates available on the active host

Options:
  --server <url>            override the configured server URL
  --json                    emit raw JSON instead of the default table
  -h, --help                display help

Examples:
  dam templates list
  dam templates list --json | jq '.[].id'
```

**`compose.ts`** — wire the module the same way `instances/compose.ts` does. The function signature mirrors `composeInstancesModule`; it returns `{ commands, exports }` (the `exports` may be empty — `templates` has no downstream consumers yet, but keep the shape for symmetry).

**`index.ts`** — re-export types only:

```ts
export type { TemplatesService, Template } from "./services/templates-service.js";
```

**`src/compose.ts`** — wire the new module after `instances`:

```ts
const templates = composeTemplatesModule({
  tokenProvider: auth.exports.tokenProvider,
  configService: cli.services.configService,
  compatService: cli.services.compatService,
  serverEnvVar: "DAM_SERVER",
});
// ...
for (const command of templates.commands) program.addCommand(command);
```

### 3.2 `dam instances create <name>`

**File:** `packages/cli/src/modules/instances/commands/create.ts` (new).

#### Command signature

```
Usage: dam instances create <name> [options]

Create a new Instance from a template on the active host

Arguments:
  <name>                    Instance name (1+ chars, must not start with 'inst-')

Options:
  --server <url>            override the configured server URL
  --template <id>           template id (required; see 'dam templates list')
  --description <text>      free-form description
  --env <KEY=VAL>           env var (repeatable)
  --wait                    poll until state == 'running' (or terminal error)
  --timeout <seconds>       --wait timeout in seconds (default 120)
  --json                    emit raw Instance JSON instead of the default summary
  -h, --help                display help

Examples:
  dam instances create my-agent --template claude-code
  dam instances create my-agent --template claude-code --wait
  dam instances create my-agent --template pi-agent --env OPENAI_API_KEY=sk-… --description "Coding helper"
```

`--env` repeatable: commander `.option("--env <KEY=VAL>", "...", (val, prev: string[]) => [...prev, val], [] as string[])`.

#### Local pre-validation (before any RPC)

Order matters — fail fast on local issues:

1. `<name>` non-empty (commander enforces because of `<name>` required arg).
2. `<name>` does not start with `inst-` (case-sensitive). On failure: stderr `` error: instance name `<name>` cannot start with `inst-` (reserved for IDs) ``, exit 2.
3. `--template` present. On absence: stderr ``error: `--template` is required; run `dam templates list` to see options``, exit 2.
4. Parse `--env` values. For each entry:
   - Split on the **first** `=`. The right-hand side may contain `=`.
   - Missing `=` → exit 2, stderr `` error: invalid `--env` value `<input>`; expected KEY=VAL ``.
   - Key must match `/^[A-Z_][A-Z0-9_]*$/` (matches server's `ENV_NAME_RE`). On miss: stderr `` error: invalid env var name `<key>`; must match [A-Z_][A-Z0-9_]* ``, exit 2.
   - Empty value (`KEY=`) is valid.
   - On duplicate keys, **later wins** silently. Per UX §1.6.

#### RPC sequence (happy path: 3 calls)

```
1. templates.list()              -- validate --template id; on miss, exit 2 with available list
2. agents.create({ templateId, description?, env? })   -- env + description on the AGENT
3. instances.create({ name, agentId })                 -- name only
```

Note **env and description go to `agents.create`**, not `instances.create`. This matches the UI behavior so subsequent UI edits land where the user expects.

The `--wait` polling (step 4) only runs after step 3 succeeds; see §3.3 below.

#### Compat + auth pre-flight

Same skeleton as `list.ts` / `get.ts`. Run `compatService.check({ flag })`, handle `below-floor` / `behind-current` / `probe-error` exactly as those commands do (reuse `printCompatResolveError` from `errors.ts`). Then resolve the host via `configService.getResolved`.

#### Template validation (step 1)

```ts
const templatesSvc = createTemplatesService({ trpc });
const tmplResult = await templatesSvc.list();
if (!tmplResult.ok) { /* handle transport / auth same as list verb */ }
const match = tmplResult.value.find((t) => t.id === opts.template);
if (!match) {
  const available = tmplResult.value.map((t) => t.id).join(", ");
  process.stderr.write(`error: unknown template \`${opts.template}\`; available: ${available || "(none)"}\n`);
  process.exit(EXIT_INSTANCES_INVALID_INPUT);
}
```

Use `EXIT_INSTANCES_INVALID_INPUT` (exit code 2) — the user supplied a bad flag value.

#### `agents.create` (step 2)

```ts
let agentId: string;
try {
  const agent = await trpc.agents.create.mutate({
    name,
    templateId: opts.template,
    description: opts.description,
    env: parsedEnv.length > 0 ? parsedEnv : undefined,
  });
  agentId = agent.id;
} catch (e) {
  // Server gave us a typed NOT_FOUND for unknown template (Phase 1 change),
  // but we pre-validated in step 1, so a NOT_FOUND here is a race
  // (someone deleted the template between list and create).
  // Surface the same "unknown template" message.
  if (hasTrpcCode(e, "NOT_FOUND")) {
    process.stderr.write(`error: template \`${opts.template}\` was deleted while creating; retry\n`);
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }
  // Any other error: no agent was created. Surface and exit.
  process.stderr.write(`error: failed to create agent: ${errorReason(e)}\n`);
  process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
}
```

#### `instances.create` (step 3) — with rollback

```ts
let instance: Instance;
try {
  instance = await trpc.instances.create.mutate({ name, agentId });
} catch (e) {
  await tryRollbackAgent(trpc, agentId, e);
  process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
}
```

The rollback function:

```ts
const ROLLBACK_CODES = new Set([
  "CONFLICT", "BAD_REQUEST", "NOT_FOUND",
  "UNAUTHORIZED", "FORBIDDEN", "PRECONDITION_FAILED",
]);

async function tryRollbackAgent(trpc: TrpcClient, agentId: string, originalError: unknown): Promise<void> {
  const code = trpcCode(originalError);
  if (!code || !ROLLBACK_CODES.has(code)) {
    // Ambiguous outcome (INTERNAL_SERVER_ERROR, network) — DON'T roll back.
    // The instance may or may not exist. Surface the error and the orphan agent id.
    process.stderr.write(`error: failed to create instance: ${errorReason(originalError)}\n`);
    process.stderr.write(`hint: agent \`${agentId}\` may be orphaned; check via the web UI\n`);
    return;
  }
  // Typed error — instance was not created. Try to remove the agent.
  try {
    await Promise.race([
      trpc.agents.delete.mutate({ id: agentId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("rollback timeout")), 10_000)),
    ]);
    // Rollback succeeded — surface only the original error.
    const msg = trpcMessage(originalError) ?? errorReason(originalError);
    process.stderr.write(`error: ${msg}\n`);
  } catch (rollbackErr) {
    // Rollback failed — surface both errors.
    process.stderr.write(`error: ${errorReason(originalError)}\n`);
    process.stderr.write(`error: also failed to clean up agent \`${agentId}\`: ${errorReason(rollbackErr)}\n`);
    process.stderr.write(`hint: delete the orphan agent via the web UI\n`);
  }
}
```

Helpers `trpcCode(e)`, `trpcMessage(e)`, `hasTrpcCode(e, code)` lift the trpc-error shape. Pattern: `e.data?.code`, `e.message`. See [`instances-service.ts:82–88`](../../../packages/cli/src/modules/instances/services/instances-service.ts) for the existing `hasTrpcCode` definition — re-use, don't re-implement.

#### `--wait` polling (step 4)

See §3.3 below for the shared wait helper. Skip if `--wait` not set.

#### Output

**Default (no `--wait`):**
```
✓ Created instance "foo" (inst-abc123). State: starting.
```

**With `--wait` (settled):**
```
Waiting for "foo"… state: starting
state: running
✓ Created instance "foo" (inst-abc123). State: running.
```

The progress lines go to **stderr** (one per state change, not per poll). The final success line goes to **stdout**.

**`--json`:**

Suppress all prose. Print the post-create (or post-wait) `Instance` object as a single JSON line to stdout. Re-fetch via `instances.get({ id })` after `--wait` settles so the JSON reflects the final state. Even without `--wait`, the `instances.create` mutation returns the freshly-built `Instance` — use it directly; no extra `get` round-trip needed.

### 3.3 Shared `--wait` helper

**File:** `packages/cli/src/modules/instances/services/wait-for-state.ts` (new).

```ts
import type { Instance } from "api-server-api";
import type { InstancesService } from "./instances-service.js";

export interface WaitOptions {
  timeoutSeconds: number;
  /** Sleep before the first poll (used by restart; create passes 0). */
  graceSeconds: number;
  /** Called once per state change (not per poll). Use it to write progress lines. */
  onStateChange?: (state: Instance["state"]) => void;
}

export type WaitResult =
  | { kind: "ready"; instance: Instance }
  | { kind: "error"; instance: Instance }       // terminal error state
  | { kind: "timeout"; lastState: Instance["state"] }
  | { kind: "transport"; reason: string };

const POLL_INTERVAL_MS = 2000;

export async function waitForRunning(
  svc: InstancesService,
  id: string,
  opts: WaitOptions,
): Promise<WaitResult> {
  if (opts.graceSeconds > 0) {
    await new Promise((r) => setTimeout(r, opts.graceSeconds * 1000));
  }
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  let lastState: Instance["state"] | undefined;
  while (Date.now() < deadline) {
    const result = await svc.get(id);
    if (!result.ok) return { kind: "transport", reason: result.error.reason ?? "transport" };
    if (result.value === null) return { kind: "transport", reason: "instance disappeared during wait" };
    const inst = result.value;
    if (inst.state !== lastState) {
      lastState = inst.state;
      opts.onStateChange?.(inst.state);
    }
    if (inst.state === "running") return { kind: "ready", instance: inst };
    if (inst.state === "error") return { kind: "error", instance: inst };
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { kind: "timeout", lastState: lastState ?? "starting" };
}
```

Notes:
- The 2 s poll cadence is locked. Don't make it configurable.
- The grace period is only used by `restart`; `create` passes 0.
- The `Instance.state` field is computed server-side from `currentState` and `podReady` (see [`instance-assembly.ts:18`](../../../packages/api-server/src/modules/instances/domain/instance-assembly.ts)). `state === "running"` already implies pod readiness; no separate check needed in the CLI.

Use in `create.ts`:

```ts
if (opts.wait) {
  const timeoutSec = Number.isFinite(Number(opts.timeout)) && Number(opts.timeout) > 0 ? Number(opts.timeout) : 120;
  const waitResult = await waitForRunning(
    svc, instance.id,
    {
      timeoutSeconds: timeoutSec,
      graceSeconds: 0,
      onStateChange: (state) => {
        if (lastState === undefined) {
          process.stderr.write(`Waiting for "${name}"… state: ${state}\n`);
        } else {
          process.stderr.write(`state: ${state}\n`);
        }
        lastState = state;
      },
    },
  );
  // handle waitResult.kind: ready | error | timeout | transport
}
```

### 3.4 Extend the CLI `InstancesService`

The CLI's internal `InstancesService` ([`packages/cli/src/modules/instances/services/instances-service.ts`](../../../packages/cli/src/modules/instances/services/instances-service.ts)) currently exposes only `list` and `get`. Phase 3 doesn't need new methods on the CLI service for `create` — the command file talks to the raw `trpc` client directly for the `agents.create` + `instances.create` orchestration since the rollback is too command-shaped to belong in the service layer.

**However**, the create command does need `instances.get` (for `--wait` re-fetches), which already exists. **No service-layer changes in Phase 3.** Phase 4 (delete + restart) will add `delete` and `restart` to the CLI service.

### 3.5 Wire commands into `instances/compose.ts`

Add `buildCreateCommand` import and `parent.addCommand(buildCreateCommand({...}))` after the existing `get` registration. The deps mirror `buildGetCommand`'s shape:

```ts
parent.addCommand(
  buildCreateCommand({
    compatService: opts.compatService,
    configService: opts.configService,
    createInstancesService: createService,
    /** Phase 3 only: command needs the raw trpc for orchestration. */
    createTrpcClient: (host) => createTrpcClient({ host, getToken }),
    serverEnvVar: opts.serverEnvVar,
  }),
);
```

The `createTrpcClient` factory is shared with the existing `createService` — refactor `composeInstancesModule` so both are produced from the same `getToken` closure (already defined inline at [`compose.ts:46–59`](../../../packages/cli/src/modules/instances/compose.ts)). Extract that `getToken` closure into a local variable so both factories reuse it.

### 3.6 Update help text and Examples on existing verbs

Phase 2's UX alignment didn't add `Examples:` to existing commands. Add them now to `list.ts` and `get.ts` for symmetry — two examples each:

```
Examples:
  dam instances list
  dam instances list --json
```

```
Examples:
  dam instances get my-agent
  dam instances get inst-abc123 --json
```

Use `.addHelpText("after", "Examples:\n  ...\n")` (commander supports this verbatim).

## Tests

Selective, per [spec §5](../188-instances-create-spec.md#5-test-strategy):

### Unit tests (worth writing)

1. **Env-var parser** — `packages/cli/src/modules/instances/commands/__tests__/parse-env.test.ts` (or wherever the helper lands; suggest extracting `parseEnvFlag(values: string[]): Result<EnvVar[], EnvParseError>` into `commands/create.ts` or `commands/parse-env.ts`).
   Cases:
   - `["KEY=VAL"]` → `[{ name: "KEY", value: "VAL" }]`.
   - `["KEY="]` → `[{ name: "KEY", value: "" }]`.
   - `["KEY"]` → error (no `=`).
   - `["123KEY=foo"]` → error (bad name).
   - `["KEY=a=b=c"]` → `[{ name: "KEY", value: "a=b=c" }]` (split on first `=`).
   - `["KEY=1", "KEY=2"]` → `[{ name: "KEY", value: "2" }]` (later wins).

2. **Name validator** — small enough to inline as a single `validateInstanceName(name: string): Result<void, string>` and test in the same file. Cases:
   - `"foo"` → ok.
   - `"instance-foo"` → ok (only the literal `inst-` prefix is reserved).
   - `"inst-foo"` → error.
   - `""` — actually commander rejects empty args, but add a unit guard anyway since the validator may be called from JSON-driven contexts later.

### Integration tests (one happy + one negative)

These run against the live k3s cluster started by `mise run cluster:install`. Add a single integration test file at `packages/cli/__tests__/integration/instances-create.test.ts` (or wherever the existing integration harness lives — check `packages/cli/src/__tests__/` for existing patterns; if there's no integration harness yet, defer this to a separate "test scaffolding" task and rely on the manual smoke test below).

If a harness exists, two scenarios:

1. **Happy path:** create instance → assert it appears in list → get it → assert template + image fields are populated. (Delete it as cleanup; if Phase 4's delete isn't done yet, fall back to deleting via the raw tRPC.)
2. **Negative pre-check:** `dam instances create x --template no-such-template` → exit 2; verify (via direct k8s read) that NO orphan agent ConfigMap exists with the test-run owner label.

### What NOT to test

- Templates-list table rendering. Trivial; breakage is visible.
- Rollback unit tests. The rollback path is mostly tRPC-error classification; mocking the trpc client extensively just re-tests the mock.
- Commander wiring. Covered by the integration test.

## Verification (smoke test)

Run in order; do not move to Phase 4 until all pass.

1. **Compile + unit tests clean:**
   ```sh
   mise run check
   mise run test
   ```

2. **Build CLI:**
   ```sh
   mise run cli:build
   ```

3. **Cluster up:**
   ```sh
   mise run cluster:install   # or `cluster:start` if you already have a VM
   export KUBECONFIG="$(mise run cluster:kubeconfig)"
   ```

4. **`dam templates list`:**
   ```sh
   mise run cli:dev -- templates list
   ```
   Expected: 3-column table with `claude-code`, `pi-agent`, etc. Sorted by NAME.

   ```sh
   mise run cli:dev -- templates list --json | jq '.[].id'
   ```
   Expected: list of template IDs on stdout.

5. **`dam instances create` happy path:**
   ```sh
   mise run cli:dev -- instances create my-test-1 --template claude-code --wait
   ```
   Expected:
   - stderr: `Waiting for "my-test-1"… state: starting`, then `state: running`.
   - stdout (last line): `✓ Created instance "my-test-1" (inst-…). State: running.`
   - `mise run cluster:kubectl -- get pod inst-…-0` shows `Running` (the pod id is the instance id from the success line + `-0`).

6. **Verify projection (depends on Phase 1):**
   ```sh
   mise run cli:dev -- instances get my-test-1
   ```
   Expected vertical block includes:
   ```
   TEMPLATE:  claude-code
   IMAGE:     <the configured image>
   ```

7. **`--env` + `--description`:**
   ```sh
   mise run cli:dev -- instances create my-test-2 --template pi-agent \
     --env FOO=bar --env BAZ= --description "smoke test" --wait
   ```
   - Both env vars must appear on the agent's spec (`mise run cluster:kubectl -- get cm <agentId> -o yaml | yq '.data.spec'`).
   - The description must appear on `dam instances get my-test-2`.
   - `BAZ=` (empty value) is preserved (not stripped).

8. **`--env` invalid:**
   ```sh
   mise run cli:dev -- instances create x --template claude-code --env BADKEY
   ```
   Expected: exit 2, stderr: `` error: invalid `--env` value `BADKEY`; expected KEY=VAL ``. No agent created — verify with `mise run cluster:kubectl -- get cm -l type=agent`.

9. **Unknown template (rollback path is unreachable but pre-check fires):**
   ```sh
   mise run cli:dev -- instances create x --template no-such
   ```
   Expected: exit 2, stderr: `` error: unknown template `no-such`; available: claude-code, pi-agent, … ``. No agent created.

10. **Reserved name prefix:**
    ```sh
    mise run cli:dev -- instances create inst-foo --template claude-code
    ```
    Expected: exit 2, stderr: `` error: instance name `inst-foo` cannot start with `inst-` (reserved for IDs) ``. No agent created.

11. **Duplicate name (server CONFLICT → rollback):**
    ```sh
    mise run cli:dev -- instances create my-test-1 --template claude-code
    ```
    Expected: exit 1, stderr: `error: instance name already exists` (the server's message). Crucially, verify **no orphan agent**:
    ```sh
    mise run cluster:kubectl -- get cm -l type=agent | wc -l
    ```
    Same count as before the duplicate attempt.

12. **`--json` happy path:**
    ```sh
    mise run cli:dev -- instances create my-test-3 --template claude-code --wait --json
    ```
    Expected: stdout = single JSON object with `id`, `name="my-test-3"`, `templateId="claude-code"`, `state="running"`. No prose anywhere.

13. **`--wait` timeout:**
    Use a deliberately broken template (or `--timeout 1`):
    ```sh
    mise run cli:dev -- instances create my-test-4 --template claude-code --wait --timeout 1
    ```
    Expected: exit 1, stderr ends with `timed out waiting for "my-test-4" to reach running (current: <state>)`. The instance is still present (no rollback on wait timeout) — verify with `dam instances list`.

14. **Help text:**
    ```sh
    mise run cli:dev -- instances create --help
    mise run cli:dev -- templates list --help
    ```
    Both show `Examples:` sections; no trailing period on the description; sentence case.

15. **Cleanup:** delete the smoke-test instances. Phase 4 will add `dam instances delete`; until then, use the UI or the raw tRPC.

If any step fails, stop and fix before moving to Phase 4.

## Out of scope

- `dam instances delete` — Phase 4.
- `dam instances restart` — Phase 4.
- Provider secrets (`secrets.setAgentAccess`) — epic 4 (separate issue).
- App connections (`connections.setAgentConnections`) — epic 4.
- Egress preset (`--egress-preset`) — epic 10. The created agent inherits the server default (`trusted`).
- `--env-file` flag — deferred.
- Streaming JSON progress during `--wait` — final object only.
- Color output.

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Spec — §4.2 create](../188-instances-create-spec.md#42-dam-instances-create-name)
- [Spec — §4.5 templates list](../188-instances-create-spec.md#45-dam-templates-list)
- [Spec — §4.6 --wait semantics](../188-instances-create-spec.md#46---wait-semantics-locked)
- [Analysis — §3.1 create RPC sequence](../188-instances-create.md#31--dam-instances-create-name)
- [Architecture — CLI](../../architecture/cli.md)
- [Architecture — Agent lifecycle](../../architecture/agent-lifecycle.md)
