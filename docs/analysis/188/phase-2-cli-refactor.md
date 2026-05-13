# Phase 2 — CLI refactor + UX alignment

**Issue:** [#188](https://github.com/dam-agents/dam/issues/188), Phase 2 of 5
**Blocks:** Phases 3, 4
**Prerequisites:** [Phase 1](phase-1-server.md) done and smoke-tested.

## Goal

Two pure-refactor things, no new features:

1. **Extract duplicated error helpers and lift the trpc-client** so Phase 3's `templates` module can reuse them without copy-paste.
2. **Align existing user-facing strings** to the locked UX conventions so the four new verbs (Phases 3 & 4) inherit a consistent surface.

Behavior must not change beyond message wording. No new commands, no new tRPC routes.

## Why this comes second

Phase 3 introduces a brand-new `templates` module that needs the same tRPC client wiring as `instances`, and the new `create`/`delete`/`restart` verbs will copy the existing `list`/`get` error-handling skeleton. Extracting the shared pieces *before* duplicating them keeps the new-verb diffs reviewable and prevents three or four parallel forks of the same helper.

The UX alignment is the same idea: lock the conventions in existing code first, then Phase 3+ mirrors them.

## Background (what you need to know)

The CLI is a TypeScript monorepo package at [`packages/cli`](../../../packages/cli/). It uses commander.js for argument parsing and is composed via a per-module `compose.ts` pattern (see [`packages/cli/src/compose.ts`](../../../packages/cli/src/compose.ts)).

Current module structure:

```
packages/cli/src/
├── bin.ts            entrypoint
├── compose.ts        wires the program
├── result.ts         Result<T,E> helper (ok/err/map/flatMap)
└── modules/
    ├── auth/         dam auth login | logout | status
    ├── cli/          dam config set | ping | version
    └── instances/    dam instances list | get
```

Each module has `commands/`, `domain/`, `infrastructure/`, `services/`, and `compose.ts`.

Two helpers are currently **duplicated** between [`instances/commands/list.ts`](../../../packages/cli/src/modules/instances/commands/list.ts) and [`instances/commands/get.ts`](../../../packages/cli/src/modules/instances/commands/get.ts):

- `printCompatResolveError(e, serverEnvVar)` — emits one of three stderr messages (`missing-config`, `malformed-config`, `probe-error`) on a compat pre-flight failure.
- `describeConfigError(e)` — turns a config-resolve error into a one-line string.

The tRPC client factory lives at [`instances/infrastructure/trpc-client.ts`](../../../packages/cli/src/modules/instances/infrastructure/trpc-client.ts), exported as `createInstancesTrpcClient`. It also exports `AuthRequiredAtTransportError` (a sentinel class) and the `InstancesTrpcClient` type alias. Phase 3's `templates` module will need the same client wired against the same `TokenProvider` — it doesn't need an `Instances`-specific name.

## Concrete changes

### 2.1 Lift the tRPC client to `shared/trpc/`

**Create:** `packages/cli/src/modules/shared/trpc/trpc-client.ts` (new folder).

Move the contents of [`packages/cli/src/modules/instances/infrastructure/trpc-client.ts`](../../../packages/cli/src/modules/instances/infrastructure/trpc-client.ts) into the new file. Rename:

- `createInstancesTrpcClient` → `createTrpcClient`
- `InstancesTrpcClient` (type alias) → `TrpcClient`
- `TrpcClientDeps` keeps the same name.
- `AuthRequiredAtTransportError` keeps the same name.

The function body stays identical.

**Update callers:**

- [`packages/cli/src/modules/instances/compose.ts`](../../../packages/cli/src/modules/instances/compose.ts) line 6 — import from `"../shared/trpc/trpc-client.js"` and call `createTrpcClient(...)` instead of `createInstancesTrpcClient(...)`. The return value type changes from `InstancesTrpcClient` to `TrpcClient`.
- [`packages/cli/src/modules/instances/services/instances-service.ts`](../../../packages/cli/src/modules/instances/services/instances-service.ts) lines 5–7 — update the import path; rename the type usage.
- Delete the old file at `packages/cli/src/modules/instances/infrastructure/trpc-client.ts`.

The `shared/` folder has no `compose.ts`, `index.ts`, or barrel. It's a flat utility folder. Treat it as a CLI-internal seam, not a public module.

### 2.2 Extract shared error helpers for the `instances` module

**Create:** `packages/cli/src/modules/instances/commands/errors.ts`.

Move both helpers verbatim from `list.ts` and `get.ts`, exported:

```ts
export function describeConfigError(e: { kind: string; reason?: string }): string {
  if (e.kind === "malformed-config") return e.reason ?? "config is malformed";
  return "no server configured";
}

export function printCompatResolveError(
  e: { kind: string; reason?: string; code?: string; message?: string },
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run \`dam config set server <url>\` or set \`${serverEnvVar}\`\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason ?? "config malformed"}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: cannot reach server: ${e.message ?? e.code ?? "unknown"}\n`);
      return;
    default:
      process.stderr.write(`error: ${e.kind}\n`);
  }
}
```

Note the change: the `"no server configured"` message now uses **backticks** around `dam config set …` and the env var name, per UX §1.5. The `cannot reach server` line stays as `cannot reach server: <detail>` (still without backtick-wrapped host because the host isn't available at this code path — it's a config-resolve error, not a probe of a known host). See §2.5 below for the host-aware variant.

**Update callers:**

- `list.ts` and `get.ts` — remove the inline definitions, import from `./errors.js`.

### 2.3 UX string alignment in `instances/commands/`

Apply the UX conventions (locked in [spec §1](../188-instances-create-spec.md#1-cli-ux-conventions-locked)).

**[`list.ts`](../../../packages/cli/src/modules/instances/commands/list.ts):**

- **Column rename (depends on Phase 1):** change `AGENT` column to `TEMPLATE`. Source from `i.templateId ?? "<custom>"` instead of `i.agentId`. Header stays UPPERCASE.
- **Empty-state hint:** after `process.stderr.write("No instances.\n")`, add a second line `process.stderr.write("hint: create one with \`dam instances create <name> --template <id>\`\n");`. Both lines go to stderr; the exit stays 0.
- **`printServiceError`** (lines 135–144): change the auth-required indentation. Current:
  ```
  error: not authenticated: <reason>
         run "dam auth login" first
  ```
  New (`hint:` prefix, no indent, backticks):
  ```
  error: not authenticated: <reason>
  hint: run `dam auth login` first
  ```
  And the transport error: replace `error: cannot reach server: <reason>` with `error: cannot reach server \`<host>\`: <reason>`. The host comes from the `cfg.value.server` that was just resolved — thread it through `printServiceError(error, host)`.

**[`get.ts`](../../../packages/cli/src/modules/instances/commands/get.ts):**

- **Field renames (depends on Phase 1):** `AGENT:` line in `renderInstance()` becomes `TEMPLATE:`, sourced from `instance.templateId ?? "<custom>"`. Add an `IMAGE:` line beneath it, sourced from `instance.image`.
- **Dynamic key:value padding:** replace the hardcoded 8-space alignment in `renderInstance()` with `max(keyLen) + 2 spaces`:
  ```ts
  function renderInstance(instance: Instance): string {
    const entries: [string, string][] = [
      ["NAME", instance.name],
      ["ID", instance.id],
      ["TEMPLATE", instance.templateId ?? "<custom>"],
      ["IMAGE", instance.image],
      ["STATE", instance.state],
    ];
    if (instance.description) entries.push(["DESCRIPTION", instance.description]);
    entries.push(["CHANNELS", renderChannels(instance.channels)]);
    entries.push([
      "ALLOWED",
      instance.allowedUserEmails.length === 0 ? "<none>" : instance.allowedUserEmails.join(", "),
    ]);
    if (instance.state === "error" && instance.error) entries.push(["ERROR", instance.error]);
    const pad = Math.max(...entries.map(([k]) => k.length)) + 2;
    return entries.map(([k, v]) => `${k}:${" ".repeat(pad - k.length)}${v}`).join("\n") + "\n";
  }
  ```
- **Argument description (line 27):** change from `Instance Ref — name or ID (\`inst-...\`)` to `Instance Ref — name or 'inst-…' ID` (single-quote the literal prefix; em dash; describe the ID with the actual prefix word). Sentence case, no period (matches §1.1).
- **Resolve-error messages (lines 117–138):** apply backtick/quote rules from UX §1.5.
  - `no instance with id 'foo'` → `` no instance with id `foo` `` (IDs are tokens → backticks).
  - `no instance named 'foo'` → `no instance named "foo"` (user-typed names → double quotes).
  - `multiple instances named 'foo':` → `multiple instances named "foo":`.
  - The disambiguation list (lines 125–127) currently writes `  <id>\n`. Change to `  - \`<id>\`\n` for visual consistency with backticked IDs.
  - The trailing `specify by id instead.\n` (line 128) → `hint: specify by id instead\n` (no period; hint prefix).
  - Auth-required block (lines 131–135): match `list.ts` change above — `hint:` prefix, no indent.
  - Transport (line 138): include host — `cannot reach server \`<host>\`: <reason>`. Thread `host` into `printResolveError`.

### 2.4 UX string alignment in `auth/commands/` and `cli/commands/`

These changes are narrow; only the strings called out below.

**[`auth/commands/login.ts`](../../../packages/cli/src/modules/auth/commands/login.ts):**

- Line 39 and similar — change `run "dam config set server <url>" or set ${serverEnvVar}` to use **backticks**: `` run `dam config set server <url>` or set `${serverEnvVar}` ``.
- Line 138 (`requires-force`): `pass --force …` → `` pass `--force` … ``.
- The success message on line 107–109 already uses `✓ Logged in to …` — keep as-is (matches §1.3).

**[`auth/commands/logout.ts`](../../../packages/cli/src/modules/auth/commands/logout.ts):**

- Line 29 and any similar `"dam config set …"` strings — backtick them.
- The `✓` success message stays.

**[`auth/commands/status.ts`](../../../packages/cli/src/modules/auth/commands/status.ts):**

- Line 29: `"No hosts configured. Run 'dam auth login' to authenticate.\n"` is currently emitted on **stdout**. Per §1.4, empty-state goes to stderr. Move to `process.stderr`. Also align the message: `No hosts configured.\nhint: run \`dam auth login\` to authenticate\n` (two lines, both stderr, both ending without a period on the hint line).
- Line 55: `failed to read credential store: …` is fine; no change needed.

**[`cli/commands/ping.ts`](../../../packages/cli/src/modules/cli/commands/ping.ts):**

- Line 64: same backtick treatment as login.ts.
- Lines 79, 81, 83, 85 (probe error variants): all four currently start with verbs and don't include the host. Rewrite to the canonical form using the host the user just probed:
  - `cannot reach server \`<host>\`: <message>`
  - `server \`<host>\` did not respond in time: <message>`
  - `server \`<host>\` returned <message>`
  - `server \`<host>\` returned unexpected response: <message>`
  Thread `host` through `describeProbeError`. The host is available from the upstream `compat.check` result; if the current code path doesn't carry it, plumb it through.

**[`cli/commands/config-set.ts`](../../../packages/cli/src/modules/cli/commands/config-set.ts):**

- Line 50: `unknown config key 'foo'` → `` unknown config key `foo` `` (token, backtick).
- Line 55: `invalid value for ${e.key}` already uses bare key; wrap it in backticks: `` invalid value for `${e.key}` ``.
- Line 62: `cannot write ${e.path}` → `` cannot write `${e.path}` ``.
- Line 65: `required config 'foo' is not set` → `` required config `foo` is not set ``.
- Line 39 (success line): keep `wrote ${key} = ${value} to ${path}` as-is. Config writes intentionally do NOT use `✓` (see §1.3).

### 2.5 Host parameter on transport errors

A common thread above: errors phrased `cannot reach server …` should carry the host so the user sees which one failed. After this phase the canonical helper signature is:

```ts
function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}
```

Add this to `instances/commands/errors.ts` and use it from `list.ts` / `get.ts`. The `cli/commands/ping.ts` and `auth/commands/login.ts` host-aware variants can stay inline since they don't share the resolve flow — but emit the **same string shape** so the user sees a consistent format regardless of which command issued the request.

### 2.6 What does NOT change

- Exit codes — `exit-codes.ts` files in `auth/commands/`, `cli/commands/`, `instances/commands/` stay as-is. The four new verbs will reuse `EXIT_INSTANCES_*` codes.
- Table rendering algorithm in `list.ts` — already correct (left-aligned, two-or-three spaces between columns). Keep behavior; only swap the AGENT → TEMPLATE column header.
- Service-layer signatures. The internal `InstancesService` (CLI side, not server) gains new methods in Phase 3, not now.
- The `Result<T,E>` shape in `result.ts`. Don't refactor it.

## Tests

Update existing tests that grep for the old strings (search the codebase for the literal strings being changed):

```sh
grep -rn "cannot reach server\|run \"dam\|No instances\.\|No hosts configured" packages/cli/src
```

For each test that asserts on a changed string, update the expected string to the new one. Do not add new tests in this phase — string changes are mechanical and the existing tests, once updated, cover them.

The Phase 3 integration test (lifecycle on k3s) will exercise the refactored helpers end-to-end.

## Verification (smoke test)

1. **Compile and unit tests clean:**
   ```sh
   mise run check
   mise run test
   ```

2. **Build the CLI:**
   ```sh
   mise run cli:build
   ```

3. **Bring the cluster up** (or reuse Phase 1's cluster if still running):
   ```sh
   mise run cluster:install
   ```

4. **Configure the CLI to point at the cluster.** From a fresh shell:
   ```sh
   mise run cli:dev -- config set server http://api-server.localhost:4444
   mise run cli:dev -- auth login
   ```
   The `✓ Logged in to …` message must still render. The `run \`dam config set …\`` hint (if it appears in the auth flow) must be **backticked**.

5. **`dam instances list` smoke:**
   ```sh
   mise run cli:dev -- instances list
   ```
   - **If instances exist** (create one via UI if not): table header must show `NAME  ID  TEMPLATE  STATE` (not `AGENT`). Each row's TEMPLATE column shows the template id (e.g. `claude-code`) or `<custom>`.
   - **Empty state:** delete all instances via UI, then re-run. stderr shows:
     ```
     No instances.
     hint: create one with `dam instances create <name> --template <id>`
     ```
     Exit code 0. (Note: `dam instances create` does not exist yet — the hint is forward-looking and lands as a working command in Phase 3.)
   - **`--json` empty:** `mise run cli:dev -- instances list --json` outputs `[]\n` on stdout, nothing on stderr.

6. **`dam instances get` smoke:**
   - **Happy path** (with one instance present): `mise run cli:dev -- instances get <name>` shows a vertical block whose keys align to `max(keyLen) + 2`. `TEMPLATE:` and `IMAGE:` lines both present. No `AGENT:` line.
   - **Unknown ID:** `mise run cli:dev -- instances get inst-doesnotexist` exits 5, stderr: `` error: no instance with id `inst-doesnotexist` ``.
   - **Unknown name:** `mise run cli:dev -- instances get bogus` exits 5, stderr: `error: no instance named "bogus"`.
   - **Server unreachable:** stop the api-server pod (`mise run cluster:kubectl -- scale deploy/api-server --replicas=0`), then run any verb. The error must read `error: cannot reach server \`<host>\`: <detail>`. Restore: `mise run cluster:kubectl -- scale deploy/api-server --replicas=1`.

7. **`dam auth status` empty case:**
   With auth wiped (`rm -rf ~/.local/state/dam/auth.toml` — destructive, only smoke-environment), run `mise run cli:dev -- auth status`. Output goes to **stderr**, not stdout:
   ```
   No hosts configured.
   hint: run `dam auth login` to authenticate
   ```
   `mise run cli:dev -- auth status 2>/dev/null` must produce no stdout output. Re-run `auth login` to restore.

8. **`dam ping` error path:** With the api-server scaled to 0 again, `mise run cli:dev -- ping` shows `error: cannot reach server \`<host>\`: <detail>`. Restore replica count after.

9. **Grep audit** — no stale strings remain:
   ```sh
   grep -rn "AGENT:" packages/cli/src
   grep -rn "       run \"dam auth login\"" packages/cli/src   # old indent style
   grep -rn "'dam config set\|'dam auth login'" packages/cli/src
   ```
   All three should return nothing (or only the comment in `phase-2-cli-refactor.md` itself if grepping from repo root — limit grep to `packages/cli/src`).

If any step fails, fix and re-verify before declaring Phase 2 done.

## Out of scope

- New commands (deferred to Phase 3 and 4).
- New tests — only string updates to existing tests.
- Refactoring `Result<T,E>` or any domain types.
- Changes to `auth/`, `cli/` exit codes or service interfaces.
- Color output. Stays plain text per UX §1.3 (the `✓` is a literal Unicode glyph, not ANSI).

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Spec — §1 CLI UX conventions](../188-instances-create-spec.md#1-cli-ux-conventions-locked) (full convention list)
- [Spec — §2 Pre-work](../188-instances-create-spec.md#2-pre-work-one-shot-refactor-separate-commit)
- [Architecture — CLI](../../architecture/cli.md)
