import { Asleep, Awake } from "@carbon/icons-react";
import { match } from "ts-pattern";

import { cn } from "@/lib/utils";

import { PROCESS_GROUP_LABEL } from "../lib/process-copy.js";
import type { ProcessGroup as ProcessGroupData } from "../lib/process-groups.js";
import { GROUP_HEADING_CLASS, GroupCount } from "./group-heading.js";
import { ProcessRow } from "./process-row.js";

interface Props {
  agentId: string;
  group: ProcessGroupData;
  alwaysOn: boolean;
  now: Date;
  openOutputKey: string | null;
  onOpenOutput: (key: string) => void;
}

export function ProcessGroup({
  agentId,
  group,
  alwaysOn,
  now,
  openOutputKey,
  onOpenOutput,
}: Props) {
  return (
    <section data-testid="process-group" data-group={group.id}>
      <h3
        className={cn(
          GROUP_HEADING_CLASS,
          group.id === "awake" && "text-warning-fg",
        )}
      >
        <GroupIcon id={group.id} />
        {PROCESS_GROUP_LABEL[group.id]}
        <GroupCount count={group.rows.length} />
      </h3>
      <ul>
        {group.rows.map((row) => (
          <ProcessRow
            key={row.key}
            agentId={agentId}
            row={row}
            alwaysOn={alwaysOn}
            now={now}
            outputOpen={row.key === openOutputKey}
            onOpenOutput={onOpenOutput}
          />
        ))}
      </ul>
    </section>
  );
}

function GroupIcon({ id }: { id: ProcessGroupData["id"] }) {
  return match(id)
    .with("awake", () => <Awake size={14} aria-hidden />)
    .with("hibernates", () => <Asleep size={12} aria-hidden />)
    .with("turn", "always-on", () => null)
    .exhaustive();
}
