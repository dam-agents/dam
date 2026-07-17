import type {
  EgressRulesRepository,
  NewEgressRule,
} from "../infrastructure/egress-rules-repository.js";
import { needsL7Promotion } from "../domain/l7-promotion.js";
import type { K8sAllowOnlySecretsPort } from "../infrastructure/k8s-allow-only-secrets-port.js";

/**
 * Insert path for rules born from inbox verdicts (approve-permanent /
 * deny-forever). Unlike the user-scoped service, it takes the agent owner's
 * sub per call — the approvals module resolves it from the pending row.
 *
 * Mirrors the manual-create path's L7 promotion: a narrow rule written from
 * an inbox verdict (possible when the held request was plain HTTP, where
 * method/path are visible without MITM) must promote its host onto the L7
 * chain, or the rule's HTTPS half is silently unenforced (#2322).
 */
export interface CreateEgressRuleWriterDeps {
  repo: EgressRulesRepository;
  /** Optional so non-cluster contexts (tests) can skip the side effect. */
  allowOnlySecrets?: K8sAllowOnlySecretsPort;
}

export function createEgressRuleWriter(deps: CreateEgressRuleWriterDeps): {
  insert(input: NewEgressRule & { ownerSub: string }): Promise<void>;
} {
  return {
    async insert({ ownerSub, ...row }) {
      await deps.repo.insert(row);
      if (
        needsL7Promotion(row.method, row.pathPattern, row.port) &&
        deps.allowOnlySecrets
      ) {
        await deps.allowOnlySecrets.ensure(ownerSub, row.host);
      }
    },
  };
}
