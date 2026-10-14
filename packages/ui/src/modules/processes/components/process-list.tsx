import type { ProcessList as ProcessListData } from "agent-runtime-api";
import { useMemo } from "react";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useToggleProcessOutput } from "../hooks/use-toggle-process-output.js";
import { groupProcesses } from "../lib/process-groups.js";
import { FinishedList } from "./finished-list.js";
import { PendingRestartBanner } from "./pending-restart-banner.js";
import { ProcessGroup } from "./process-group.js";

interface Props {
  agentId: string;
  list: ProcessListData;
  alwaysOn: boolean;
}

export function ProcessList({ agentId, list, alwaysOn }: Props) {
  const now = useNow(1_000);
  const openOutputKey = useStore((s) => s.openProcessOutputKey);
  const toggleOutput = useToggleProcessOutput();
  const groups = useMemo(
    () => groupProcesses(list.running, alwaysOn),
    [list.running, alwaysOn],
  );
  const onOpenOutput = (key: string) => void toggleOutput(key);

  return (
    <div className="flex-1 overflow-y-auto">
      {list.pendingRestart && (
        <PendingRestartBanner
          agentId={agentId}
          pendingRestart={list.pendingRestart}
        />
      )}
      {groups.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          Nothing is running
        </p>
      ) : (
        groups.map((group) => (
          <ProcessGroup
            key={group.id}
            agentId={agentId}
            group={group}
            alwaysOn={alwaysOn}
            now={now}
            openOutputKey={openOutputKey}
            onOpenOutput={onOpenOutput}
          />
        ))
      )}
      <FinishedList
        rows={list.finished}
        now={now}
        openOutputKey={openOutputKey}
        onOpenOutput={onOpenOutput}
      />
    </div>
  );
}
