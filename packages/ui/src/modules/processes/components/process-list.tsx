import type { ProcessList as ProcessListData } from "agent-runtime-api";
import { useMemo } from "react";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useToggleProcessOutput } from "../hooks/use-toggle-process-output.js";
import { PROCESS_KIND_ORDER } from "../lib/process-copy.js";
import { FinishedList } from "./finished-list.js";
import { ProcessRow } from "./process-row.js";

interface Props {
  list: ProcessListData;
  alwaysOn: boolean;
}

export function ProcessList({ list, alwaysOn }: Props) {
  const now = useNow(1_000);
  const openOutputKey = useStore((s) => s.openProcessOutputKey);
  const toggleOutput = useToggleProcessOutput();
  const running = useMemo(
    () =>
      [...list.running].sort(
        (a, b) =>
          PROCESS_KIND_ORDER.indexOf(a.kind) -
            PROCESS_KIND_ORDER.indexOf(b.kind) ||
          Date.parse(a.startedAt) - Date.parse(b.startedAt),
      ),
    [list.running],
  );
  const onOpenOutput = (key: string) => void toggleOutput(key);

  return (
    <div className="flex-1 overflow-y-auto">
      {running.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          Nothing is running
        </p>
      ) : (
        <ul>
          {running.map((row) => (
            <ProcessRow
              key={row.key}
              row={row}
              alwaysOn={alwaysOn}
              now={now}
              outputOpen={row.key === openOutputKey}
              onOpenOutput={onOpenOutput}
            />
          ))}
        </ul>
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
