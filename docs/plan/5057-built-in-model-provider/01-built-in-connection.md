# 01 — Built-in Connection and its operator config

**Part of:** Built-in model provider — see [README](./README.md)

## Context

This slice gives a Connection a **built-in** mark and the operator a place to name the built-in providers and their key.
It creates no Connection for anyone yet (slice 02 does); it makes a built-in Connection safe to exist: the user cannot edit or delete it, its key follows the chart, and turning the provider off withdraws it.

## Implementation plan

Apply `/typescript-engineering`.

1. **Chart.**
   - `helm/values.yaml`, under `apiServer`, next to `oauthAppDefaults`:
     ```yaml
     builtInProviders:
       dailyTokenAllowance: 5000000   # PROPOSED D1; read by slice 03
       curveBender:
         enabled: false
         key: ""                      # operator service key; never printed
     ```
     Comment it like `oauthAppDefaults`: what it does for users, that the key is shared by every user's built-in Connection, and that `enabled: false` withdraws existing ones.

   - Render the key into the existing api-server credentials Secret (`helm/templates/apiserver/credentials.yaml`) and pass it to the pod as a `secretKeyRef` env in `helm/templates/apiserver/app.yaml`, the way the OAuth client secrets go.

   - `helm/templates/_validators.tpl`: fail the render when `enabled: true` and `key` is empty.
2. **Config.** `packages/api-server/src/config.ts`: `builtInProviders: { dailyTokenAllowance: number; providers: { templateId: "curve-bender"; key: string }[] }`, only enabled ones in the list.
   Keep the list keyed by template id so a second built-in provider is one more chart entry and one more map line.
3. **Schema.** `packages/db/src/schema.ts`, `connections`:
   - `builtIn: boolean("built_in").notNull().default(false)`.
   - A partial unique index `connections_owner_builtin_template_idx` on `(owner, template_id) WHERE built_in`.
   - `mise run //packages/db:generate`.
4. **Repository and service** (`packages/api-server/src/modules/connections/`):
   - Carry `builtIn` through the repository row mapping and the domain type.
   - In `services/connections-service.ts`, refuse delete, rename, input update and credential rotation on a built-in Connection with a typed domain error, mapped to tRPC `FORBIDDEN` with the text "This connection is included with <brand> and cannot be changed."
     (brand from config).
     Grants and revokes stay allowed.
   - Add `builtIn: boolean` to the connection view schema in `packages/api-server-api/src/modules/connections/` and fill it.
   - Skip the provider balance (`getProviderBalance`) for a built-in Connection: `/key/info` would report the shared service key.
5. **Key sync and withdraw sweep.** A periodic job (register with `periodicJobs` in `packages/api-server/src/bootstrap.ts`, at boot and every 10 minutes), in the connections module:
   - For each enabled built-in provider: page through built-in Connections of that template whose Secret's stored key hash differs from the SHA-256 of the configured key, and rewrite the Secret through the existing rotation write path (`secret-store/infrastructure/k8s-secret-store.ts`), so the SDS the gateway reads is rebuilt.
     Store the hash beside the value on the Secret (an annotation) so the sweep never reads the key back.
     Clear a withdrawn mark if present.
   - For each built-in Connection whose template is not enabled: set the credential-expired marker the refresh loop already uses, with a reason `withdrawn`, so the existing expired surfaces show it.
     Do not delete.
   - Serialize per Connection with the existing per-Connection credential lock.
6. **Docs** (same commit):
   - `docs/architecture/connections.md`: a "Built-in Provider Connections" subsection under Connection — what it is, who creates it (slice 02 fills the when), what the user can and cannot do, key sync, withdraw.
     Add one sentence to the CurveBender preset section.
   - `docs/ubiquitous-language.md`: **Built-in Provider**, **Built-in Provider Connection**.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass; the migration applies on a fresh and an existing database.
- [ ] `helm template` (through the chart's mise check) fails with `enabled: true` and no key, and passes otherwise.
- [ ] A built-in row inserted by hand: `connections.delete`, rename and rotate are refused with `FORBIDDEN`; grant and revoke work.
- [ ] Changing the chart key rewrites that Connection's Secret within one sweep; the agent's next model call carries the new key.
- [ ] Turning the provider off marks the Connection expired with reason `withdrawn`; turning it on clears it.

## Smoke test

On the dev cluster with the chart key set and `enabled: true`:

1. Insert one built-in Connection for user `dev` by calling the service from a one-off script or the db shell (slice 02 automates this), then restart the api-server so the sweep writes its Secret.
2. `dam connection list` shows it; `dam connection delete <id>` fails with the built-in text.
3. Grant it to an agent and send a prompt: the gateway's access log shows a call to the CurveBender host (a 503 without VPN is fine).
4. Set `enabled: false`, upgrade: `dam connection list` shows it expired.
