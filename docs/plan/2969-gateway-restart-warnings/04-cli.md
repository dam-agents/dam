# 04 — CLI gives the same answer

**Depends on:** 01-shared-promotion-predicate
**Part of:** Network gateway restart warnings — see [README](./README.md)

## Context

`dam network` is a fourth surface with its own copy of the guess. `create` and `update`
each test the shape of the flags they were given, so they prompt on hosts that are already
inspected and on the catch-all `*`, and `update` cannot see the rule it is patching.
`revoke` never prompts, so removing the last narrowing rule interrupts the sandbox with no
warning — the same silent case as the UI. The wording is wrong too: it says the *agent*
restarts, when the agent keeps running and only the gateway is replaced.

## Implementation plan

Apply [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md).

### Contract: a rule lookup by id

1. `dam network update <rule-id>` and `dam network revoke <rule-id>` know only a rule id.
   To answer the restart question they need the rule's agent, and `update` also needs the
   rule's current shape, because it patches a subset of the fields. Add an
   `egressRules.get` query:
   - input schema in
     [`packages/api-server-api/src/modules/egress-rules/schemas.ts`](../../../packages/api-server-api/src/modules/egress-rules/schemas.ts)
     (noun-first, no inline schema in the router)
   - procedure in the sibling `router.ts`, `readAgentProcedure`, with the same
     `checkAgentBinding` treatment `listForAgent` uses
   - a `get` on the api-server's egress-rules service. `repo.getById` already exists and is
     used by `update`; the ownership check pattern is right above it in
     [`egress-rules-service.ts`](../../../packages/api-server/src/modules/egress-rules/services/egress-rules-service.ts)
   - a `get` on the CLI's
     [`EgressService`](../../../packages/cli/src/modules/egress/services/egress-service.ts),
     returning the same `Result` shape as `update`, including `RuleNotFoundError`

### Commands

2. [`create.ts`](../../../packages/cli/src/modules/egress/commands/create.ts) — replace
   `requiresRestart` (line ~80) with a `gatewayRestartImpact` call. The agent is already
   resolved just above; fetch its rules with `listForAgent`, and pass the new rule as an
   add with `source: "manual"`.

3. [`update.ts`](../../../packages/cli/src/modules/egress/commands/update.ts) — replace
   `requiresRestart` (line ~74). `get` the rule, `listForAgent` its agent, then model the
   patch as a removal of the rule plus an add of the patched rule, so the impact accounts
   for the *before* shape as well as the *after*. Patching a rule can demote a host.

4. [`revoke.ts`](../../../packages/cli/src/modules/egress/commands/revoke.ts) — new
   confirmation. `get` the rule, compute the impact of `{ removeIds: [id] }`, and prompt
   only when it demotes. Keep the command idempotent: an unknown id still exits 0 without
   prompting.

5. Preserve the existing gate mechanics in all three: `-y, --yes` skips the prompt, and a
   non-TTY stdin without `--yes` exits `EXIT_INVALID_INPUT` with a message — but only when
   a prompt would actually have fired. A change that does not restart must never fail on a
   non-interactive stdin. Add `-y, --yes` to `revoke`, matching the other two.

6. Fix the copy in all three. The gateway restarts, the sandbox keeps running, ~5–15s of
   interrupted outbound requests. Name the hosts being promoted or demoted. Update the
   `--yes` option description, which currently says "path-level restart confirmation" — the
   trigger is no longer path-level.

## Acceptance criteria

- [ ] `dam network create` prompts only when the rule promotes a host that is not already
      promoted; a `*` host and an already-inspected host do not prompt.
- [ ] `dam network update` accounts for both the rule's old and new shape, and prompts on a
      demotion as well as a promotion.
- [ ] `dam network revoke` prompts when it demotes a host, and stays idempotent and silent
      for an unknown id.
- [ ] `--yes` skips every prompt; non-TTY without `--yes` fails only when a prompt was due.
- [ ] No CLI message claims the agent or the sandbox restarts.
- [ ] `mise run check`, `mise run test` and `mise run common:check:comment-types` pass.

## Smoke test

Build the CLI and drive it against the local cluster with a headless token (recipe in the
[README](./README.md)), watching the gateway pod UID between steps:

```bash
DAM_TOKEN=$TOK DAM_SERVER=http://localhost:4444 node packages/cli/dist/bin.js network create <sandbox> --host api.example.com --path '/v1/*'
```

Expected sequence on one sandbox:

1. The command above prompts. Accept — the pod UID changes.
2. The same command with `--path '/v2/*'` does not prompt, and the pod UID does not change.
3. `network create ... --host '*' --path '/v1/*'` does not prompt.
4. `network revoke <the /v2 rule id>` does not prompt.
5. `network revoke <the /v1 rule id>` prompts. Accept — the pod UID changes.
6. Step 1 again with `--yes` on a non-TTY stdin succeeds without prompting.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
