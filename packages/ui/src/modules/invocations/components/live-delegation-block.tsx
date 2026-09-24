import { useMemo, useState } from "react";

import { ActivityBlock } from "../../sessions/components/activity-block.js";
import { useRunningDelegations } from "../api/queries.js";
import { countByStatus, flattenIds } from "../lib/delegation-state.js";
import { DelegationHeader } from "./delegation-block.js";
import { DelegationCards } from "./delegation-cards.js";

interface Props {
  driverAgentId: string;
  active: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a fan-out's tool chip reaches the transcript only
 * when the driver's script exits, after every child has reported, so while the
 * driver is busy the children are shown from the record instead. The block
 * disappears once no child is running; the chip's own block takes over then.
 */
export function LiveDelegationBlock({ driverAgentId, active }: Props) {
  const [open, setOpen] = useState(true);
  const { data } = useRunningDelegations(driverAgentId, active);
  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  if (!active || nodes.length === 0) return null;
  const total = flattenIds(nodes).length;
  const counts = countByStatus(nodes);

  return (
    <ActivityBlock
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={
        <DelegationHeader
          text={`Delegating to ${total} temporary agent${total === 1 ? "" : "s"}`}
          working={counts.running}
          failed={counts.failed}
        />
      }
    >
      <DelegationCards nodes={nodes} driverAgentId={driverAgentId} />
    </ActivityBlock>
  );
}
