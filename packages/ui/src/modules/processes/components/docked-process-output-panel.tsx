import { Close } from "@carbon/icons-react";
import { useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";

import { TruncateStart } from "../../../components/truncate-start.js";
import { processList, processOutput } from "../../../mock/data/processes.js";
import { useStore } from "../../../store.js";
import { useStickToBottom } from "../hooks/use-stick-to-bottom.js";
import { findListedProcess } from "../lib/listed-process.js";
import { PROCESS_OUTPUT_MAX_BYTES } from "../types.js";

interface Props {
  agentId: string;
  outputKey: string;
}

export function DockedProcessOutputPanel({ outputKey }: Props) {
  const close = useStore((s) => s.setOpenProcessOutputKey);
  const listed = useMemo(
    () => findListedProcess(processList, outputKey),
    [outputKey],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <TruncateStart
            className="font-mono text-sm font-medium text-foreground"
            title={listed?.command}
          >
            {listed?.command ?? "Output"}
          </TruncateStart>
          {listed?.outputPath && (
            <TruncateStart
              className="font-mono text-2xs text-muted-foreground"
              title={listed.outputPath}
            >
              {listed.outputPath}
            </TruncateStart>
          )}
        </div>
        {listed && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {listed.status}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>
      {listed ? (
        <OutputBody outputKey={outputKey} />
      ) : (
        <Notice text="This process is no longer listed." />
      )}
    </div>
  );
}

function OutputBody({ outputKey }: { outputKey: string }) {
  const data = processOutput[outputKey] ?? null;
  const bodyRef = useRef<HTMLPreElement>(null);
  const onScroll = useStickToBottom(bodyRef, data?.text);

  if (!data) return <Notice text="This output can't be read." />;
  return (
    <>
      {data.truncated && (
        <p className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          Showing the last {PROCESS_OUTPUT_MAX_BYTES / 1024} KiB.
        </p>
      )}
      <pre
        ref={bodyRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs text-foreground"
      >
        {data.text || (
          <span className="text-muted-foreground">No output yet.</span>
        )}
      </pre>
    </>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-4 py-5 text-sm text-muted-foreground">{text}</p>;
}
