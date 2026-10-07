import { useMemo } from "react";

import { useRunningDelegations } from "../api/queries.js";
import { DelegationShell } from "./delegation-shell.js";

interface Props {
  driverAgentId: string;
  busy: boolean;
  claimed: ReadonlyMap<string, unknown>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a fan-out's tool chip reaches the transcript only
 * when the driver's script exits — or, for a script run in the background,
 * only when the driver reads its output in a later turn — so until then nothing
 * in the conversation speaks for the children and this block does it from the
 * record, whether or not the driver's turn is still running. It shows only children no chip accounts for yet, so the two
 * can never describe the same child: the handover happens in the render the
 * chip lands, not on this block's next poll.
 */
export function LiveDelegationBlock({ driverAgentId, busy, claimed }: Props) {
  const { data } = useRunningDelegations(driverAgentId, {
    busy,
    watch: claimed.size > 0,
  });
  const nodes = useMemo(
    () => (data?.nodes ?? []).filter((node) => !claimed.has(node.id)),
    [data, claimed],
  );
  if (nodes.length === 0) return null;

  return (
    <DelegationShell
      verb="Delegating to"
      nodes={nodes}
      driverAgentId={driverAgentId}
    />
  );
}
