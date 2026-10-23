import type { SpendCeilingEntry } from "api-server-api";

import { OperatorEntryRow } from "../../operator/components/operator-entry-row.js";
import { ceilingPerDay } from "../lib/copy.js";

interface Props {
  entry: SpendCeilingEntry;
  onChange: (entry: SpendCeilingEntry) => void;
  onRemove: (entry: SpendCeilingEntry) => void;
  removing: boolean;
}

export function SpendCeilingRow({
  entry,
  onChange,
  onRemove,
  removing,
}: Props) {
  const user = entry.email ?? entry.ownerSub;
  return (
    <OperatorEntryRow
      user={user}
      ownerSub={entry.ownerSub}
      setBy={{
        email: entry.setByEmail,
        sub: entry.setBySub,
        at: entry.updatedAt,
      }}
      values={ceilingPerDay(entry.amountMicros)}
      changeLabel={`Change the spend ceiling of ${user}`}
      removeLabel={`Remove the spend ceiling of ${user}`}
      onChange={() => onChange(entry)}
      onRemove={() => onRemove(entry)}
      removing={removing}
    />
  );
}
