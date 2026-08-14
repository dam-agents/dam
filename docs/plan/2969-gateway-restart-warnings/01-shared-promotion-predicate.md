# 01 — One promotion answer in the contract

**Part of:** Network gateway restart warnings — see [README](./README.md)

## Context

`promotedHosts()` is the server's projection of an agent's rules onto `spec.l7Hosts`, and
the only correct answer to "will the gateway restart". It lives in the api-server domain,
where no client can reach it, so the UI and CLI each carry an approximation instead. This
slice moves the function into the contract package all three already depend on, and adds
the companion that answers the question for a *pending* change. Behavior does not change
anywhere: this slice ends with the server computing exactly what it computes today.

## Implementation plan

Apply [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md).

1. Create `packages/api-server-api/src/modules/egress-rules/promotion.ts`. It must be
   browser-safe — no `@trpc/server`, no `router.ts` import. `format.ts` in the same folder
   is the precedent for a pure shared module here.

2. Move `needsL7Promotion`, `promotedHosts` and the `PromotionRule` interface into it,
   verbatim, from
   [`packages/api-server/src/modules/egress-rules/domain/l7-promotion.ts`](../../../packages/api-server/src/modules/egress-rules/domain/l7-promotion.ts).
   Do not change the filtering rules — host `*`, `connection:` sources and wildcard shapes
   are all deliberate, and the README records why.

3. Add the impact function. Suggested shape — adjust names to fit the package's
   noun-first conventions, but keep the three-part result, because every surface needs to
   name the hosts in its dialog copy:

   ```ts
   export interface GatewayRestartImpact {
     promoted: string[];
     demoted: string[];
     willRestart: boolean;
   }

   export function gatewayRestartImpact(input: {
     current: readonly (PromotionRule & { id: string })[];
     adds?: readonly PromotionRule[];
     removeIds?: readonly string[];
   }): GatewayRestartImpact;
   ```

   It applies `removeIds` then `adds` to `current`, runs `promotedHosts()` over both the
   before and after sets, and diffs them. `willRestart` is `promoted.length > 0 ||
   demoted.length > 0` — never a per-rule shape test.

   `EgressRuleView` already satisfies `PromotionRule & { id: string }`, so callers pass the
   `listForAgent` result straight in.

4. Export both from `packages/api-server-api/src/index.ts`, next to the existing
   `./modules/egress-rules/format.js` exports.

5. Delete `packages/api-server/src/modules/egress-rules/domain/l7-promotion.ts` and
   repoint its three importers at `api-server-api`:
   - [`services/egress-rules-service.ts`](../../../packages/api-server/src/modules/egress-rules/services/egress-rules-service.ts)
   - [`services/egress-rule-writer.ts`](../../../packages/api-server/src/modules/egress-rules/services/egress-rule-writer.ts)
   - [`services/l7-promotion-reconcile.ts`](../../../packages/api-server/src/modules/egress-rules/services/l7-promotion-reconcile.ts) (also imports the `PromotionRule` type)

6. Update the "L7 promotion" section of
   [`docs/architecture/security-and-credentials.md`](../../architecture/security-and-credentials.md):
   the projection function is shared with the api-server's clients, so the UI and CLI
   answer the restart question with the server's own rule rather than their own. Refresh
   the page's `Last verified:` date. Follow
   [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md);
   do not reference the issue or an ADR from the page.

## Acceptance criteria

- [ ] `promotedHosts` and `needsL7Promotion` exist in exactly one place, in
      `api-server-api`, and the api-server imports them from there.
- [ ] `gatewayRestartImpact` reports `willRestart: false` when the promoted-host set is
      unchanged, and names the hosts in `promoted` / `demoted` when it is not.
- [ ] No behavior change on the server: the projection written to `spec.l7Hosts` is
      byte-identical to before for the same rule set.
- [ ] `mise run check` and `mise run test` pass, including the existing
      `l7-promotion-reconcile.test.ts`.
- [ ] `mise run common:check:comment-types` passes.

## Smoke test

Run the existing suite and the type/lint gate — this slice is a refactor, so the
existing tests are the check:

```bash
mise run check && mise run test
```

Then confirm the server still projects correctly against the live cluster. Add a
narrowing rule and read the projection back (token and observe commands are in the
[README](./README.md)):

```bash
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' 'http://localhost:4444/api/trpc/egressRules.create' -d '{"agentId":"<agent-id>","host":"api.example.com","method":"*","pathPattern":"/v1/*","verdict":"allow"}'
```

`spec.l7Hosts` becomes `["api.example.com"]` and the gateway pod UID changes. Revoke the
rule and it returns to `[]`.
