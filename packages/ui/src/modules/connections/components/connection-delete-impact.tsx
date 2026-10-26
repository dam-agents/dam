import { Callout } from "@/components/ui/callout";

import { AffectedAgents } from "../../agents/components/affected-agents.js";

export function ConnectionDeleteImpact({
  agents,
}: {
  agents: readonly string[] | null;
}) {
  return (
    <>
      <p>
        This connection will be deleted. Any agent using it may no longer
        function as expected.
      </p>
      {agents === null ? (
        <Callout
          tone="muted"
          className="mt-4 text-sm"
          data-testid="delete-agents-unknown"
        >
          Couldn&rsquo;t read which agents hold this connection.
        </Callout>
      ) : (
        agents.length > 0 && <AffectedAgents names={agents} />
      )}
    </>
  );
}
