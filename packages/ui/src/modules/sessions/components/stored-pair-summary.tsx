import { aliasForProviderType, parseQualifiedModel } from "api-server-api";

import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useProviderConnections } from "../api/session-pair.js";
import { pairSummary } from "../lib/session-settings.js";
import { PairSummary } from "./session-pair-trigger.js";

/** UNIT_BOUNDARY_DESCRIPTION: a stored pick of an agent's, such as a schedule's own values, as the same one-line summary: the provider named by the model's alias, the effort read from the agent's harness. */
export function StoredPairSummary({
  agentId,
  harness,
  model,
  settings,
}: {
  agentId: string;
  harness: string;
  model: string;
  settings: Readonly<Record<string, string>>;
}) {
  const carried = useHarnessConfigStatus(agentId).data?.harnesses;
  const { owned } = useProviderConnections(agentId);
  const alias = parseQualifiedModel(model, { claudePrefix: true })?.alias;
  return (
    <PairSummary
      harness={harness}
      label={pairSummary(model, {
        settings,
        capability: carried?.find((h) => h.name === harness),
        provider: owned.find((p) => aliasForProviderType(p.type) === alias)
          ?.name,
      })}
    />
  );
}
