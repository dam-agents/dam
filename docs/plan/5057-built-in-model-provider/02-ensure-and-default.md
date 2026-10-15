# 02 — Ensure step and default provider

**Depends on:** 01-built-in-connection
**Part of:** Built-in model provider — see [README](./README.md)

## Context

This slice makes every user hold their Built-in Provider Connections without doing anything, and makes agents use them only when the user has nothing of their own.
It is the slice that removes the obstacle of #5057; the allowance (03) only bounds its cost.
The sibling plan #5058 relies on the ensure step running inside agent create, because a user onboarded from Slack never opens the UI.

## Implementation plan

Apply `/typescript-engineering`.

1. **`ensureBuiltInProviders(owner)`** on the per-owner connections service (`packages/api-server/src/modules/connections/services/connections-service.ts`):
   - For each enabled built-in provider from config, insert the Connection with `INSERT … ON CONFLICT DO NOTHING` on the partial unique index from slice 01, built by the template's existing `build()` (`domain/catalog.ts`, `CURVE_BENDER`) with the operator key as its credential.
   - Name: the template's display name; on an `(owner, name)` conflict, append ` 2`, ` 3`, ….
   - Write the per-Connection Secret (owner label, key, key-hash annotation) before the row commits, as `create` does; on a lost race, delete the orphan Secret.
   - Emit the existing connect domain event only for a row it inserted, so `attach-first-provider` (`sagas/attach-first-provider.ts`) grants it to the owner's agents that hold no provider, and activity counts it once.
     Mark the event as built-in so the getting-started "create a connection" task does not count it (`packages/api-server/src/modules/getting-started/`): the user did not create anything.
   - Per-replica memo of owners already ensured, cleared when the config changes (i.e. never at runtime).
2. **Callers.**
   - A saga on `EventType.UserAuthenticated` (`packages/api-server/src/events.ts`), modelled on `modules/usage/sagas/persist-actor-roles.ts`, wired in `bootstrap.ts` with `connectionsServiceFor(owner)`.
     Failures log and retry on the next event; they never fail a request.
   - The agent create path: in `connectionGrantProvisioner` (`packages/api-server/src/modules/agents/compose.ts`), call `ensureBuiltInProviders` before `defaultProviderConnection`.
     This is the one create every path ends in, so starter-kit apply, the CLI and Slack onboarding (#5058) get it too.
3. **Default rule.** `defaultProviderConnection` (connections-service.ts) today prefers `ibm-litellm`, then the oldest fitting active provider.
   New order: own `ibm-litellm`, then own oldest fitting, then built-in oldest fitting.
   Put the ranking in the connections domain as one pure function so the create path and step 4 share it.
4. **Own provider takes over (PROPOSED D8).** Extend the attach-first-provider saga: when the user connects a provider that is not built-in, for each of their agents whose granted providers are all built-in and whose harness fits the new one:
   - grant the new Connection;
   - set the agent's remembered default Session Pair to it (the harness-config default-pair write the Providers page uses), keeping the harness.
     The built-in grant stays.
     Agents that already hold an own provider are untouched.
5. **Empty states.** With a built-in provider enabled, a user never has zero providers, so the chat's "Connect an LLM provider" modal (`packages/ui/src/modules/sessions/views/chat-view.tsx`, `noProviders`) no longer shows for a new user; leave it for installs with none.
   No UI change in this slice beyond that falling out.
6. **Docs** (same commit):
   - `docs/architecture/connections.md`: when the platform creates a built-in Connection (first meeting, every create), the race-safety, and that it is created for existing users too.
   - `docs/architecture/agent-lifecycle.md#create`: the new default rule and the take-over on the first own provider.
   - `docs/architecture/getting-started.md`: the built-in Connection does not complete "create a connection".

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] A user with no Connections signs in: exactly one built-in Connection exists after two parallel requests on two replicas.
- [ ] A user who never opened the UI and creates an agent through the CLI (`dam agent create`) gets a built-in Connection granted to the agent.
- [ ] A user with an own IBM LiteLLM Connection creating an agent gets the own one, not the built-in.
- [ ] Connecting a first own provider moves an agent that held only the built-in one onto it as default; the built-in grant remains.
- [ ] The getting-started "create a connection" task is not completed by the built-in Connection.

## Smoke test

On the dev cluster with the built-in provider enabled:

1. Delete user `dev`'s Connections and agents (UI), then reload the UI: Settings → Providers shows "CurveBender".
2. Create an agent with the default form; the agent's Providers section shows CurveBender granted and default.
   Send a prompt: the gateway calls the CurveBender host.
3. Connect an own provider in Settings: the agent's Providers section now shows both, with the own one as default.
4. `dam agent create --name cli-only` with a fresh API key of a second test user who never opened the UI: `dam connection list` as that user shows the built-in Connection.
