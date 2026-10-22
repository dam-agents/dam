# 01 — Platform operator role

**Part of:** Spend ceilings in Postgres, set by platform operators — see [README](./README.md)

## Context

The platform has no general operator role today: each operator power has its own realm role (`platform-inspector`, `platform-slack-installer`), and only Hono routes check roles.
This slice adds one general role, `platform-operator`, for acts on the whole install, and makes it usable from tRPC.
Spend ceilings (02) are its first use; compute budgets follow after this feature.
The slice also adds `operator.status`, which the CLI and the UI use to learn whether the caller is an operator.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Chart values** — [`helm/values.yaml`](../../../helm/values.yaml), in the `keycloak` block after `slackInstallerRole`:
   add `operatorRole: "platform-operator"` with a comment in the style of its neighbours.
   The comment says: holders are platform operators and act on the whole install for all users, first by setting each user's spend ceiling; the chart creates the role and an `operators` group mapped to it; grant it by adding users to the group in the Keycloak admin UI, or map an upstream SSO group to it; an empty value means the install has no operators and every operator surface refuses.
   Update the `extraTestUsers` comment so that it lists `operators` as an allowed group.
2. **Realm import** — [`helm/templates/keycloak/realm-configmap.yaml`](../../../helm/templates/keycloak/realm-configmap.yaml):
   - Add the role under `roles.realm` when `operatorRole` is set, with the description `printf "Lets a person run %s for all its users, such as their spend ceilings" .Values.brand.name`.
   - Add the group `operators` with `"realmRoles": [operatorRole]`.
   - Extend every `if or …` guard of the `roles` and `groups` blocks with `operatorRole`, and keep the comma handling right for any mix of the three roles.
   - Put the dev `testUser` into `/operators` when the role is set.
     The test user's groups are an if/else chain over two roles today; build the list with `append`, as the `extraTestUsers` loop does, instead of adding branches.
   - Accept `operators` in `extraTestUsers[].groups`, and add it to the list in the unknown-group `fail` message.
   - Render it: `mise run //helm:check:render` and `mise run //helm:check:lint`.
3. **api-server env** — [`helm/templates/apiserver/app.yaml`](../../../helm/templates/apiserver/app.yaml): add `KEYCLOAK_OPERATOR_ROLE` next to `KEYCLOAK_INSPECTOR_ROLE`, under the same kind of `if`.
4. **Config** — [`packages/api-server/src/config.ts`](../../../packages/api-server/src/config.ts): add `keycloakOperatorRole: z.string().optional()` and read `process.env.KEYCLOAK_OPERATOR_ROLE`, next to the inspector role.
5. **Principal** — [`packages/api-server/src/apps/api-server/admission/auth.ts`](../../../packages/api-server/src/apps/api-server/admission/auth.ts):
   - Add `operatorRole?: string` to `AuthConfig`.
   - In `verifyJwt`, set `isOperator: true` on the returned `user` only when `config.operatorRole` is non-empty and `roles` includes it.
   - `verifyApiKey` never sets it.
   - [`bootstrap.ts`](../../../packages/api-server/src/bootstrap.ts) passes `operatorRole: config.keycloakOperatorRole` to `createAuth`.
     The HTTP and the WebSocket tRPC paths both build their context from this `user`, so both get the flag with no other change.
6. **Contract identity** — [`packages/api-server-api/src/context.ts`](../../../packages/api-server-api/src/context.ts): add `isOperator?: boolean` to `UserIdentity`.
   It is optional so that every other principal and every existing fixture stays valid; absent means "not an operator".
7. **Procedure** — [`packages/api-server-api/src/auth-procedures.ts`](../../../packages/api-server-api/src/auth-procedures.ts): add `operatorProcedure`, a `t.procedure` with a middleware that throws `TRPCError` `FORBIDDEN` unless `ctx.user.isOperator === true`.
   The message names the role in plain words, for example "This needs the platform operator role."
   No scope check is needed: only a JWT can carry the flag, and a JWT has every scope.
8. **Status query** — new contract module `packages/api-server-api/src/modules/operator/` (`router.ts`, `schemas.ts`, `types.ts`), following the layout of the other modules:
   - `operatorStatusSchema = z.object({ isOperator: z.boolean() })` and its type.
   - `operatorRouter = t.router({ status: t.procedure.output(operatorStatusSchema).query(({ ctx }) => ({ isOperator: ctx.user.isOperator === true })) })`.
     It needs no service on `ApiContext`.
   - Register `operator: operatorRouter` in [`packages/api-server-api/src/router.ts`](../../../packages/api-server-api/src/router.ts), and export the schema and type from the package index.
9. **Docs:**
   - [`docs/architecture/security-and-credentials.md`](../../architecture/security-and-credentials.md) › Identity: add a short paragraph on platform operators: the realm role and its group, that only an interactive login (a JWT) can act as an operator and an API key never can, that an install without the role has no operators, and that the first operator power is the spend ceiling ([spend-limits](../../architecture/spend-limits.md#spend-ceiling)).
   - [`docs/ubiquitous-language.md`](../../ubiquitous-language.md): add **Platform Operator** next to the Spend Ceiling rows.

## Acceptance criteria

- [ ] The rendered realm import has the `platform-operator` role, the `operators` group, and the dev test user in `/operators`; with `operatorRole: ""` none of the three renders, and the inspector and Slack installer parts render as before.
- [ ] An `extraTestUsers` entry with `groups: [operators]` renders, and an unknown group still fails with a message that lists `operators`.
- [ ] The api-server Deployment has `KEYCLOAK_OPERATOR_ROLE` when the role is set and does not have it when the role is empty.
- [ ] `operator.status` returns `{ isOperator: true }` for a JWT with the role, `false` for a JWT without it, and `false` for an API key.
- [ ] No caller can reach `operatorProcedure` without the role (checked in the next slice, which is its first user).
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run it yourself, then print a short guide so the user can repeat it:

1. `mise run //helm:check:render` and `mise run //helm:check:lint` pass; read the rendered realm ConfigMap and the api-server env for the role.
2. Build and install the api-server and the chart on the local dev cluster (`cluster-ops` skill), and wait for the Keycloak provision job to finish.
3. Mint a `dev` token with the password grant on the `platform-ui` client (see the `cluster-ops` skill), and decode it: `realm_access.roles` holds `platform-operator`.
4. `curl -s -H "Authorization: Bearer $DAM_TOKEN" "$DAM_SERVER/api/trpc/operator.status"` returns `isOperator: true`.
5. Repeat step 4 with a test user outside the `operators` group, and with an API key (`pk_…`): both return `isOperator: false`.
