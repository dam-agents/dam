import type { SecretRequestView } from "api-server-api";

import { useAgent } from "../../agents/api/queries.js";
import { useSharedChannels } from "../../sandboxes/hooks/use-shared-channels.js";
import { ConnectionAudienceNotice } from "./connection-audience-notice.js";
import { ConnectionAudienceSentence } from "./connection-audience-sentence.js";

const receivingAgents = (view: SecretRequestView): string[] => [
  ...new Set([
    ...(view.requestedBy ? [view.requestedBy.id] : []),
    ...view.grantedAgents.map((a) => a.id),
  ]),
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: On the secret-entry page, one notice for each
 * Shared Agent that gets the connection: the one that asked for a new secret,
 * or each one a replaced secret is granted to. It names the agent's editors,
 * who can ask it to use the connection with the owner's access, and the
 * channels it is bound to. The owner reads it before saving; it never blocks.
 */
export function SecretRequestAudience({ view }: { view: SecretRequestView }) {
  return receivingAgents(view).map((agentId) => (
    <SharedAgentNotice key={agentId} agentId={agentId} />
  ));
}

function SharedAgentNotice({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId);
  const channels = useSharedChannels(agentId);
  if (agent?.access.role !== "owner" || agent.access.editors.length === 0)
    return null;
  return (
    <ConnectionAudienceNotice
      className="mt-6"
      testId={`secret-request-audience-${agentId}`}
    >
      <ConnectionAudienceSentence
        audience={{ editors: agent.access.editors, channels }}
        uses="this connection"
        agentName={agent.name}
      />
    </ConnectionAudienceNotice>
  );
}
