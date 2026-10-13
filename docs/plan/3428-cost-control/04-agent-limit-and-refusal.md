# 04 — Agent limit, refusal and "continue?"

**Depends on:** 03-receive-and-store
**Part of:** Cost control — see [README](./README.md)

## Context

This slice makes the first limit work end to end: the owner's daily dollar limit for one agent.
At the limit, the ext_authz gate refuses the next billable model call with the refusal for its API path, records the refusal, and asks the owner through a `spend_limit` approval whether to continue.
"Continue" adds one more limit amount for today.
The CLI is the first client (`dam spend`).
The chat gets a correct error hint.
The screens come in slice 07.
This slice also tests the refusal with each harness in the shared agent image.

## Implementation plan

Apply `/typescript-engineering` for server, contract and CLI code, and `/react-ui-engineering` for the two UI files in step 8.

1. **Tables** in `packages/db/src/schema.ts` (one migration, `mise run //packages/db:generate`).
   Create them with all three scopes now, so that slice 05 needs no migration.
   - `spend_limits`: id, owner sub, scope kind (`agent`, `owner`, `connection`), agent id (nullable), Connection id (nullable), unit, amount in micro-units, created and updated times.
     One limit per owner, scope kind, agent and Connection (a unique index).
   - `spend_limit_extensions`: limit id, UTC day, extension count.
     The key is the limit and the day.
   - Delete an agent's limits when the agent is deleted.
     Follow the cleanup hooks that other modules register (for example `createApprovalsCleanupHook`).
2. **Contract** in `packages/api-server-api/src/modules/spend/` (the README pins it):
   - `spend.status({ agentId? })`;
   - `spend.setLimit({ scope, amountMicros })`, with only the `agent` scope kind in this slice.
     Owner-scoped: the agent must belong to the caller.
     A limit of 0 is allowed and refuses every paid call.
3. **Limit rules** (spend domain, pure):
   - effective amount = amount × (1 + extensions today);
   - the state: `ok`, `warn` at 80% or more, `reached` at 100% or more;
   - the list of reached limits for one call, given today's counters.
     Write them so that slice 05 adds the owner limit, the Connection limits and the ceiling to the same rules.
4. **Refusal shape** (spend domain, pure), as the README's table says:
   - Anthropic Messages and Bedrock paths: 429 with `x-should-retry: false`, `retry-after` = the seconds to the next UTC midnight, at least 61, and `content-type: text/plain`.
     Bedrock was not tested: Claude Code's Bedrock client is built on the Anthropic SDK, which reads `x-should-retry`.
   - OpenAI Chat and Responses paths, Bob included: 400 with `content-type: text/plain`.
   - The soft-limit text with `config.brand.name`, no digits.
5. **The gate.**
   - Extend the spend port of slice 03: for a billable call it now returns either "allow" or "refuse" with the response and the reached limits.
   - It reads the Redis day counters only (no Postgres on the hot path).
   - In `packages/api-server/src/modules/approvals/services/ext-authz-gate.ts`, check spend after identity and before the egress rules.
     A refused call:
     - gets the shaped response;
     - adds 1 to the refused calls in `spend_daily`;
     - gets a `spend_limit` approval for each reached soft limit (step 6).
       The gate never holds a spend refusal.
   - Proto: add `DeniedHttpResponse` to `packages/api-server/proto/external_auth.proto` (`CheckResponse.denied_response`, with the HTTP status, the headers and the body).
     Copy the field numbers from the Envoy 1.39.2 protos.
     Regenerate with `mise run //packages/api-server:fix:proto`.
   - In `apps/ext-authz/grpc.ts`, extend the verdict mapping, so that a refusal sends `PERMISSION_DENIED` with the denied response.
     The existing deny stays a bare 403.
6. **Approvals.**
   - Contract `packages/api-server-api/src/modules/approvals/types.ts`: add `spend_limit` to `ApprovalType`.
     Add a payload kind `spend_limit` with the limit id, the scope, the agent, the unit, the day, the amount and the extension count when DAM asked.
     Update `describeApprovalPayload` in `format.ts`.
   - The gate inserts the row with `expiresAt` at the next UTC midnight.
     It inserts at most one row per limit, day and extension count (a lookup like `findActivePendingExtAuthz`).
     It emits `ApprovalRequested`, so that Home and the toasts update as for other approvals.
   - `approvals-service.ts`: on a `spend_limit` row, every allow action resolves the row with the verdict allow.
     This includes `approveOnce`, `approvePermanent` and `approveHost`.
     They never write an egress rule.
     `dismiss` and `denyForever` resolve it with deny.
     Today non-ext_authz rows fall into the `acp_native` branch and return `not_actionable`.
     Add a branch for `spend_limit`.
   - A spend saga (`modules/spend/sagas/`) subscribes to `ApprovalResolved`.
     On an allowed `spend_limit` row, it sets today's extension count of that limit to the payload's count plus 1.
     Use `GREATEST`, so that a repeated event does not add twice.
7. **CLI** in `packages/cli/src/modules/spend/`:
   - `dam spend status [agent] [--json]`;
   - `dam spend limit set <agent> --usd <amount>`;
   - `dam spend limit clear <agent>`.
     Parse amounts with the contract schema (`safeParse`), and convert dollars to micro-units.
     "Continue" from the CLI is the existing `dam approval approve <id>`.
     Check that `dam approval list` shows the new type in a readable way.
8. **UI, minimal** (the screens come in slice 07):
   - `packages/ui/src/modules/acp/errors.ts`: add a rule before the 402 rule.
     Today the 402 rule matches "quota exceeded" and tells the user to top up the provider account.
     The new rule matches "Spend quota exceeded".
     For the soft text, its hint says that the agent reached a spend limit for today and that the owner can continue in the app (use `getBrand()`).
     For the ceiling text, its hint says to ask the platform operator.
   - `packages/ui/src/modules/home/lib/approval-copy.ts`: a headline for `spend_limit` ("Reached its spend limit"), so that the card does not say "Wants to run a command".
9. **Refusal tests with the harnesses.**
   On the dev cluster with the shared agent image of current main, set a tiny limit and send one prompt with each harness:
   - Claude Code;
   - Codex;
   - Pi;
   - Bob, if a Bob Connection exists;
   - Claude Code on Bedrock, if a Bedrock Connection exists.
     For each, record:
   - the number of tries in the gateway log (expect 1);
   - the text that the user sees;
   - that the next prompt after "continue" works.
     If PR #4620 has merged, repeat the Claude Code and Pi runs through the Model Router.
     Put the results in the PR description, not in the docs.
10. **Docs** (same commit):
    - `docs/architecture/spend-limits.md`: sections "Limits" (agent limit, the period, soft, extensions), "Refusal" (the shape by API path, the text rules and why there are no digits, the recorded refusal) and "Continue".
    - `docs/architecture/security-and-credentials.md`, section "HITL ext_authz": the gate also refuses billable model calls at a spend limit, with a shaped response and no hold.
    - `docs/ubiquitous-language.md`: **Spend Limit**, **Extension** and **Refusal** in the Spend Limits section, and the new approval type in the Approvals section.
    - `docs/architecture/cli.md`: the `spend status` and `spend limit` commands.
    - Bump `Last verified:`, and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] `dam spend limit set <agent> --usd 0.01` stores the limit, and `dam spend status <agent>` shows it with today's spend, what is left and the state.
- [ ] When the limit is reached, the next model call is refused:
  - Claude Code tries once and shows the soft text;
  - Codex and Pi try once and show the soft text;
  - the gateway log shows one refused request per prompt.
- [ ] The refused call adds 1 to the refused calls of the day.
- [ ] One `spend_limit` approval appears, and further refusals at the same level do not add more.
- [ ] `dam approval approve <id>` on it adds one extension.
  The effective limit doubles, the next prompt works, and at the new level DAM asks again.
- [ ] After `dismiss`, DAM does not ask again that day.
- [ ] Free paths (`count_tokens`, model lists) are never refused.
- [ ] Calls on a `free` Connection (Curve Bender) are never refused.
- [ ] The chat shows the new hint, not "top up the provider account".
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

On the dev cluster:

1. `mise run cluster:build -- api-server ui`.
2. `dam spend limit set <claude-agent> --usd 0.01`.
   Send prompts until one is refused.
   The chat shows "Spend quota exceeded for today…" and the spend-limit hint.
3. `dam approval list` shows one `spend_limit` row.
   Send one more prompt: still refused, and still one row.
4. `dam approval approve <id>`.
   `dam spend status <claude-agent>` shows an effective limit of $0.02.
   The next prompt works.
5. Repeat step 2 with a Codex agent and a Pi agent (step 9 of the plan).
6. `dam spend limit clear <claude-agent>`.
   Prompts work again.

Then print a short guide for Petr, so that he can repeat steps 2 to 4 by hand.
