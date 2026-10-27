import { Close, StopFilled } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";

export function WorkProcessPanel() {
  const data = useStore((s) => s.openWorkProcess);
  const close = useStore((s) => s.setOpenWorkProcess);

  if (!data) return null;

  const isRunning = data.status === "running";
  const ok = data.exitCode === 0;

  const handleStop = async () => {
    const confirmed = await useStore
      .getState()
      .showConfirm(
        "This process keeps the agent awake. Stopping it may cause the agent to sleep.",
        "Stop process",
        { kind: "destructive" },
      );
    if (confirmed) {
      close(null);
      emitToast({ kind: "success", message: `Stopped ${data.command}` });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground">
          {data.command}
        </code>
        {isRunning ? (
          <span className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-[#24a148]/10 text-[#24a148]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#24a148]" />
            Running
          </span>
        ) : (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              ok
                ? "bg-[#24a148]/10 text-[#24a148]"
                : "bg-[#dc2626]/10 text-[#dc2626]"
            }`}
          >
            exit {data.exitCode}
          </span>
        )}
        {isRunning && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-[#dc2626] hover:text-[#dc2626]"
            aria-label="Stop process"
            tooltip="Stop process"
            onClick={handleStop}
          >
            <StopFilled size={16} />
          </Button>
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

      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
        <pre className="font-mono text-xs leading-relaxed text-foreground">
          {data.logLines.join("\n")}
        </pre>
      </div>
    </div>
  );
}
