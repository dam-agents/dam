import { useMemo } from "react";

import { useRunningDelegations } from "../api/queries.js";
import { DelegationShell } from "./delegation-shell.js";

interface Props {
  driverAgentId: string;
  active: boolean;
  claimed: ReadonlySet<string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a fan-out's tool chip reaches the transcript only
 * when the driver's script exits, after every child has reported, so until then
 * nothing in the conversation speaks for the children and this block does it
 * from the record. It shows only children no chip accounts for yet, so the two
 * can never describe the same child: the handover happens in the render the
 * chip lands, not on this block's next poll.
 */
export function LiveDelegationBlock({ driverAgentId, active, claimed }: Props) {
  const { data } = useRunningDelegations(driverAgentId, active);
  const nodes = useMemo(
    () => (data?.nodes ?? []).filter((node) => !claimed.has(node.id)),
    [data, claimed],
  );
  if (!active || nodes.length === 0) return null;

  return (
    <DelegationShell
      verb="Delegating to"
      nodes={nodes}
      driverAgentId={driverAgentId}
    />
  );
}
