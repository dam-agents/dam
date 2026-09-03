import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../../modules/agents/infrastructure/labels.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads an Agent's harness image from its Agent CR so
 * a submission can be stamped with the image that produced it. The CR is the
 * only place the image lives and it disappears with the Agent, so the value is
 * snapshotted at submit time rather than joined at read time — an Edition of a
 * deleted Agent still says which build wrote it. It lives here, as a port the
 * harness app injects, to keep the case-studies module off the k8s client.
 */
export function createAgentImageReader(k8s: K8sClient) {
  return async (agentId: string): Promise<string | null> => {
    try {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, agentId);
      const image = (obj?.spec as { image?: string } | undefined)?.image;
      return typeof image === "string" && image.length > 0 ? image : null;
    } catch {
      return null;
    }
  };
}
