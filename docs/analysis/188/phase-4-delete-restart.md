# Phase 4 — `dam instances delete` + `dam instances restart`

**Issue:** [#188](https://github.com/dam-agents/dam/issues/188), Phase 4 of 5
**Blocks:** Phase 5
**Prerequisites:** [Phase 1](phase-1-server.md), [Phase 2](phase-2-cli-refactor.md), and [Phase 3](phase-3-templates-create.md) done and smoke-tested.

## Goal

Close the instance lifecycle with two more verbs:

- `dam instances delete <ref>` — destructive; confirms before acting unless `--yes` is passed.
- `dam instances restart <ref>` — pod-only restart (PVCs preserved); reversible, no prompt.

After this phase a CLI user can fully manage an instance without touching the web UI.

## Background (what you need to know)

### Why `agents.delete`, not `instances.delete`

Phase 3 established that the CLI hides the agent-vs-instance split. Same applies here:

- **Delete** goes through `agents.delete(agentId)`. Kubernetes OwnerReferences cascade-delete the instance ConfigMap and PVCs. This mirrors the web UI exactly.
- The server's `instances.delete` route still exists (it's used in legacy 1:N flows the UI may reactivate) but the **CLI must not call it** — calling `instances.delete` would leave an orphan agent behind.

To call `agents.delete`, the CLI first needs to know the `agentId` of the instance being deleted. The new `Instance` projection from Phase 1 still exposes `agentId` (we widened it to add `templateId`/`image`, not replaced anything). Read the agent id from the resolved instance.

### Why `instances.restart`, not anything agent-level

Restart is pod-only: server-side it deletes pod-0 of the StatefulSet, the controller recreates it from the current spec, and persistent volumes (the home mount, anything the template marked `persist: true`) survive. The route is [`instances.restart`](../../../packages/api-server-api/src/modules/instances/router.ts) on the api-server. The agent ConfigMap is not touched.

### Server route shapes (already exist; do not modify)

- `agents.delete` — input `{ id }`, output void. See [`agents/router.ts`](../../../packages/api-server-api/src/modules/agents/router.ts).
- `instances.restart` — input `{ id }`, output void. Throws `TRPCError({ code: "NOT_FOUND" })` if the instance is gone. See [`instances/router.ts:51–56`](../../../packages/api-server-api/src/modules/instances/router.ts).

### Ref resolution

Both verbs accept a positional `<ref>` that can be a name or an `inst-…` id. Use the existing [`InstanceResolver`](../../../packages/cli/src/modules/instances/services/instance-resolver.ts) — the same one [`get.ts`](../../../packages/cli/src/modules/instances/commands/get.ts) uses. It returns either a resolved `Instance` or one of `not-found` / `ambiguous` / `auth-required` / `transport`.

### Confirmation prompt convention

From [spec §1.7](../188-instances-create-spec.md#17-confirmation-prompts-destructive-verbs-only):

- Pattern: `<sentence>. This <consequence>. (y/N): ` on **stderr**; read from stdin.
- Default = N. Case-insensitive match on `y`/`yes`.
- Non-tty stdin without `--yes` → exit 2 with a specific message.

Use Node's `readline/promises` (already used in [`auth/commands/login.ts:87`](../../../packages/cli/src/modules/auth/commands/login.ts) — see that file for the exact pattern, including detaching the readline interface on completion). TTY detection: `process.stdin.isTTY === true`.

### Restart wait semantics

`instances.restart` returns immediately after issuing pod-0 deletion. The reconciler picks up the change and updates `currentState`. To reliably detect the new pod is up:

- Sleep **2 seconds** before the first poll (the "grace period"). Without this, the first poll might observe stale `currentState === "running"` from the old pod.
- Poll `instances.get` every 2 seconds. Settle when `state === "running"`. Terminal failure on `state === "error"`. Timeout default 120 s.

This is exactly what the shared `waitForRunning` helper from Phase 3 does. Pass `graceSeconds: 2` for restart, `graceSeconds: 0` for create.

## Concrete changes

### 4.1 Extend the CLI `InstancesService`

**File:** [`packages/cli/src/modules/instances/services/instances-service.ts`](../../../packages/cli/src/modules/instances/services/instances-service.ts).

Add three methods to the `InstancesService` interface and implementation:

```ts
export interface InstancesService {
  list(): Promise<Result<readonly Instance[], TransportError | AuthRequiredError>>;
  get(id: string): Promise<Result<Instance | null, TransportError | AuthRequiredError>>;
  /** Cascade-delete an Agent. Used by `dam instances delete`. */
  deleteAgent(agentId: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  /** Restart an Instance (deletes pod-0). */
  restart(id: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
}
```

Add `NotFoundError` to the union — the `restart` route can throw `NOT_FOUND` even after the resolver succeeded (race: instance deleted between resolve and restart). Same for `deleteAgent` if the agent vanishes mid-flight.

The `NotFoundError` shape is already defined in [`instances/domain/errors.ts`](../../../packages/cli/src/modules/instances/domain/errors.ts) — reuse, don't redefine.

Implementations:

```ts
async deleteAgent(agentId) {
  try {
    await deps.trpc.agents.delete.mutate({ id: agentId });
    return ok(undefined);
  } catch (e) {
    if (hasTrpcCode(e, "NOT_FOUND")) return err({ kind: "not-found", ref: agentId, via: "id" });
    return classify(e);
  }
},

async restart(id) {
  try {
    await deps.trpc.instances.restart.mutate({ id });
    return ok(undefined);
  } catch (e) {
    if (hasTrpcCode(e, "NOT_FOUND")) return err({ kind: "not-found", ref: id, via: "id" });
    return classify(e);
  }
},
```

### 4.2 `dam instances delete <ref>`

**File:** `packages/cli/src/modules/instances/commands/delete.ts` (new).

#### Command signature

```
Usage: dam instances delete <ref> [options]

Delete an Instance and all its persistent data

Arguments:
  <ref>                     Instance Ref — name or 'inst-…' ID

Options:
  --server <url>            override the configured server URL
  --yes, -y                 skip the confirmation prompt
  --json                    emit { deleted, id, name } or { cancelled: true } as JSON
  -h, --help                display help

Examples:
  dam instances delete my-agent
  dam instances delete inst-abc123 --yes
```

#### Flow

1. Compat pre-flight (same skeleton as `list.ts`).
2. Config resolve → `host`.
3. Resolve `<ref>` via `InstanceResolver`. On `not-found` / `ambiguous` → print resolve error (reuse from `get.ts`), exit 5. On `auth-required` / `transport` → exit 1 with appropriate message.
4. If `--yes` not set:
   - If `process.stdin.isTTY === true`: prompt (see §4.4 below).
   - Else: stderr `` error: delete requires confirmation; pass `--yes` or run interactively ``, exit 2.
5. If user declined: stdout `Cancelled.` (or `{ "cancelled": true }` with `--json`), exit 0.
6. Call `svc.deleteAgent(instance.agentId)`.
7. On `not-found` (rare race): treat as success — the instance is gone, the user wanted it gone. Output the success line.
8. On `transport`/`auth-required`: surface the error, exit 1.
9. On success: stdout `✓ Deleted instance "<name>".` (or `{ "deleted": true, "id": "inst-…", "name": "<name>" }` with `--json`), exit 0.

#### Output examples

**Default:**
```
✓ Deleted instance "my-agent".
```

**Declined:**
```
Cancelled.
```

**`--json` success:**
```json
{"deleted":true,"id":"inst-abc123","name":"my-agent"}
```

**`--json` cancelled:**
```json
{"cancelled":true}
```

### 4.3 `dam instances restart <ref>`

**File:** `packages/cli/src/modules/instances/commands/restart.ts` (new).

#### Command signature

```
Usage: dam instances restart <ref> [options]

Restart an Instance (recreates the pod; persistent volumes survive)

Arguments:
  <ref>                     Instance Ref — name or 'inst-…' ID

Options:
  --server <url>            override the configured server URL
  --wait                    poll until state == 'running' (or terminal error)
  --timeout <seconds>       --wait timeout in seconds (default 120)
  --json                    emit raw Instance JSON
  -h, --help                display help

Examples:
  dam instances restart my-agent
  dam instances restart my-agent --wait
```

#### Flow

1. Compat pre-flight (same skeleton as `list.ts`).
2. Config resolve → `host`.
3. Resolve `<ref>`. On any resolve error: same handling as delete (exit 5 / 1).
4. Call `svc.restart(instance.id)`.
5. On `not-found` (race): exit 5 with `` error: no instance with id `<id>` `` (the resolver succeeded but the instance vanished). The resolver error renderer already handles this — feed it the same shape.
6. On transport/auth: exit 1.
7. If `--wait`:
   - Re-fetch via `svc.get(instance.id)` to confirm presence, then call `waitForRunning(svc, instance.id, { timeoutSeconds, graceSeconds: 2, onStateChange })`.
   - Same progress-output pattern as create: stderr line per state change.
   - On `ready` → success line.
   - On `error` → exit 1, stderr `` instance "<name>" entered error state: <instance.error> ``.
   - On `timeout` → exit 1, stderr `timed out waiting for "<name>" to reach running (current: <state>)`.
   - On `transport` → exit 1, surface message.
8. On success (with or without `--wait`):
   - Default: `✓ Restarted instance "<name>" (inst-…).` — append `State: running.` if `--wait` settled.
   - `--json`: re-fetch via `svc.get(instance.id)` (after wait if requested) and emit the resulting `Instance` payload.

#### Output examples

**Default:**
```
✓ Restarted instance "my-agent" (inst-abc123).
```

**With `--wait`:**
```
Waiting for "my-agent"… state: starting
state: running
✓ Restarted instance "my-agent" (inst-abc123). State: running.
```

### 4.4 Confirmation prompt helper

**File:** `packages/cli/src/modules/instances/commands/prompt.ts` (new, or inline in `delete.ts` if only used once — the latter is fine, but split if Phase 4 grows).

```ts
import { createInterface } from "node:readline/promises";

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,    // prompt goes to stderr; stdout stays clean for piping
  });
  try {
    const answer = await rl.question(`${question} (y/N): `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
```

Usage in `delete.ts`:

```ts
if (!opts.yes) {
  if (!process.stdin.isTTY) {
    process.stderr.write(`error: delete requires confirmation; pass \`--yes\` or run interactively\n`);
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }
  const proceed = await confirm(`Delete instance "${instance.name}"? This destroys all persistent data and cannot be undone.`);
  if (!proceed) {
    if (opts.json) process.stdout.write(`${JSON.stringify({ cancelled: true })}\n`);
    else process.stdout.write("Cancelled.\n");
    process.exit(EXIT_INSTANCES_SUCCESS);
  }
}
```

The prompt text doesn't include `(y/N):` itself — `confirm()` appends it, keeping the convention in one place.

### 4.5 Wire commands into `instances/compose.ts`

Add to the parent group, after `create`:

```ts
parent.addCommand(buildDeleteCommand({ ...standardDeps, createInstancesService: createService }));
parent.addCommand(buildRestartCommand({ ...standardDeps, createInstancesService: createService }));
```

Both commands use the `InstancesService` (CLI side) — no raw trpc plumbing needed here, unlike `create` (which orchestrates two routes).

## Tests

Per [spec §5](../188-instances-create-spec.md#5-test-strategy), keep selective.

### Unit tests

Optional and only if useful — the `confirm()` helper has too little logic to test in isolation. Skip.

### Integration tests

The lifecycle integration test from Phase 3 (if it exists in `packages/cli/__tests__/integration/`) extends naturally — append:

3. **Restart:** call `dam instances restart <name> --wait`; assert exit 0 and verify the pod was recreated (read pod-0's `creationTimestamp` before/after via direct k8s read; second timestamp must be strictly greater).
4. **Delete:** call `dam instances delete <name> --yes`; assert exit 0 and verify the agent ConfigMap and the instance ConfigMap are both gone within 30 seconds (poll with `kubectl get cm <agentId>`).

If the harness doesn't exist yet, defer and rely on the smoke test below.

## Verification (smoke test)

Run in order; do not start Phase 5 until all pass. Assumes `mise run cluster:install` has been done and a test instance is present (create one with `dam instances create my-test --template claude-code --wait` if needed).

1. **Compile + unit tests:**
   ```sh
   mise run check
   mise run test
   ```

2. **Build:**
   ```sh
   mise run cli:build
   ```

3. **`dam instances restart` no-wait:**
   ```sh
   export KUBECONFIG="$(mise run cluster:kubeconfig)"
   POD_BEFORE=$(mise run cluster:kubectl -- get pod -l app=instance,instance-id=<your-instance-id> -o jsonpath='{.items[0].metadata.uid}')
   mise run cli:dev -- instances restart my-test
   ```
   - stdout: `✓ Restarted instance "my-test" (inst-…).`
   - No stderr beyond compat warnings.
   - After ~5 s, `mise run cluster:kubectl -- get pod -l instance-id=<your-instance-id> -o jsonpath='{.items[0].metadata.uid}'` returns a **different** UID. (Use the instance-id label, not pod name — name stays `<instance-id>-0`.)

4. **`dam instances restart --wait`:**
   ```sh
   mise run cli:dev -- instances restart my-test --wait
   ```
   - stderr shows at least: `Waiting for "my-test"… state: starting` then `state: running`.
   - stdout ends with: `✓ Restarted instance "my-test" (inst-…). State: running.`
   - Exit 0.
   - **Crucially**, verify the wait actually waited (didn't return prematurely on stale `running` state): check that elapsed time from invocation to success line is ≥ 2 s. If it returns in < 2 s, the grace period isn't working — fix before declaring this step passed.

5. **`dam instances restart --wait --json`:**
   ```sh
   mise run cli:dev -- instances restart my-test --wait --json
   ```
   - stdout = single JSON object (`{"id":"inst-…","name":"my-test","state":"running",…}`).
   - No prose on stderr beyond compat warnings.

6. **Restart unknown ref:**
   ```sh
   mise run cli:dev -- instances restart no-such-instance
   ```
   - Exit 5, stderr: `error: no instance named "no-such-instance"`.

7. **`dam instances delete` with prompt — accept:**
   ```sh
   mise run cli:dev -- instances delete my-test
   ```
   - Interactive prompt on stderr: `Delete instance "my-test"? This destroys all persistent data and cannot be undone. (y/N): `.
   - Type `y` and press enter.
   - stdout: `✓ Deleted instance "my-test".`
   - Exit 0.
   - Within 30 s, `mise run cli:dev -- instances list` no longer shows it; `mise run cluster:kubectl -- get cm -l type=instance` no longer shows its ConfigMap; PVCs gone (`mise run cluster:kubectl -- get pvc | grep <instance-id>` returns nothing).

8. **Delete with prompt — decline:**
   Create another instance (`dam instances create my-test-2 --template claude-code --wait`), then:
   ```sh
   mise run cli:dev -- instances delete my-test-2
   ```
   Type `n`, press enter.
   - stdout: `Cancelled.`
   - Exit 0.
   - Instance still present in `dam instances list`.

9. **Delete with `--yes`:**
   ```sh
   mise run cli:dev -- instances delete my-test-2 --yes
   ```
   - No prompt.
   - stdout: `✓ Deleted instance "my-test-2".`
   - Exit 0.

10. **Delete non-tty without `--yes`:**
    ```sh
    echo "" | mise run cli:dev -- instances delete my-test-3
    ```
    (Create `my-test-3` first if needed.)
    - Exit 2, stderr: `` error: delete requires confirmation; pass `--yes` or run interactively ``.
    - Instance is still present.

11. **Delete non-tty with `--yes`:**
    ```sh
    echo "" | mise run cli:dev -- instances delete my-test-3 --yes
    ```
    - No prompt.
    - stdout: `✓ Deleted instance "my-test-3".`
    - Exit 0.

12. **`--json` cancelled:**
    Create another instance, then:
    ```sh
    mise run cli:dev -- instances delete my-test-4 --json
    ```
    Type `n`.
    - stdout: `{"cancelled":true}` followed by `\n`.
    - Exit 0.

13. **`--json` success:**
    ```sh
    mise run cli:dev -- instances delete my-test-4 --yes --json
    ```
    - stdout: `{"deleted":true,"id":"inst-…","name":"my-test-4"}` followed by `\n`.
    - Exit 0.

14. **Delete unknown ref:**
    ```sh
    mise run cli:dev -- instances delete no-such
    ```
    - Exit 5, stderr: `error: no instance named "no-such"`.

15. **Help text:**
    ```sh
    mise run cli:dev -- instances delete --help
    mise run cli:dev -- instances restart --help
    ```
    Both show `Examples:` sections; descriptions lower case start, no trailing period; sentence case.

16. **Restart of running pod doesn't break anything:** restart an instance, wait, then immediately restart again with `--wait`. Both invocations must succeed.

If any step fails, fix and re-verify before moving to Phase 5.

## Out of scope

- `dam agents delete` for orphan cleanup — deferred to a follow-up. Orphans are rare; the web UI handles them today.
- `--ignore-not-found` on delete — shell `|| true` covers scripts; defer.
- `dam instances start` / `stop` (hibernate/wake) — separate epic. Restart is enough for the demo.
- Restart progress beyond state transitions — no streaming of pod-level events.

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Spec — §4.3 delete](../188-instances-create-spec.md#43-dam-instances-delete-ref)
- [Spec — §4.4 restart](../188-instances-create-spec.md#44-dam-instances-restart-ref)
- [Spec — §4.6 --wait semantics](../188-instances-create-spec.md#46---wait-semantics-locked)
- [Analysis — §2 lifecycle model](../188-instances-create.md#2--lifecycle-model)
- [Analysis — §3.2 delete](../188-instances-create.md#32--dam-instances-delete-ref)
- [Architecture — CLI](../../architecture/cli.md)
