import {
  CONTINUED_FROM_LABEL_MAX,
  type DelegationNode,
  type PlatformContinuedFrom,
} from "api-server-api";

import { firstLine } from "./delegation-state.js";

function resultText(node: DelegationNode): string {
  const { result, errorReason } = node;
  if (typeof result === "string" && result.trim() !== "") return result;
  if (result !== undefined && result !== null && typeof result !== "string")
    return JSON.stringify(result, null, 2);
  return errorReason ? `The sub-agent failed: ${errorReason}` : "";
}

export function continuedFromOf(node: DelegationNode): PlatformContinuedFrom {
  const label = (node.label?.trim() || firstLine(node.prompt) || node.id).slice(
    0,
    CONTINUED_FROM_LABEL_MAX,
  );
  return {
    invocationId: node.id,
    label,
    prompt: node.prompt,
    result: resultText(node),
  };
}
