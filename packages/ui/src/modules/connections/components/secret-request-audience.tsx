import type { SecretRequestView } from "api-server-api";

import { useAgent } from "../../agents/api/queries.js";
import { useSharedChannels } from "../../sandboxes/hooks/use-shared-channels.js";
import { parentNoun } from "../lib/connection-hierarchy.js";
import { savesParentOnly } from "../lib/secret-request.js";
import { ConnectionAudienceNotice } from "./connection-audience-notice.js";
import { ConnectionAudienceSentence } from "./connection-audience-sentence.js";

const receivingAgents = (view: SecretRequestView): string[] => [
  ...new Set([
    ...(view.requestedBy && !savesParentOnly(view)
      ? [view.requestedBy.id]
      : []),
    ...view.grantedAgents.map((a) => a.id),
  ]),
];

const usedThrough = (view: SecretRequestView): string =>
  savesParentOnly(view)
    ? `the connections made from this ${parentNoun(view)}`
    : "this connection";

/**
 * UNIT_BOUNDARY_DESCRIPTION: On the secret-entry page, one notice for each
 * Shared Agent that gets the connection: the one that asked for a new secret,
 * or each one a replaced secret is granted to. It names the agent's editors,
 * who can ask it to use the connection with the owner's access, and the
 * channels it is bound to. A GitHub sign-in or App installation is never
 * held by an agent itself: a save that stores only the installation gives the
 * asking agent nothing, and a replaced key reaches the agents through the
 * connections made from it. The owner reads it before saving; it never blocks.
 */
export function SecretRequestAudience({ view }: { view: SecretRequestView }) {
  const uses = usedThrough(view);
  return receivingAgents(view).map((agentId) => (
    <SharedAgentNotice key={agentId} agentId={agentId} uses={uses} />
  ));
}

function SharedAgentNotice({
  agentId,
  uses,
}: {
  agentId: string;
  uses: string;
}) {
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
        uses={uses}
        agentName={agent.name}
      />
    </ConnectionAudienceNotice>
  );
}
