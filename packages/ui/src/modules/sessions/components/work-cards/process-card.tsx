import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { WorkProcess } from "../../../../types.js";
import { WorkCardShell } from "./work-card-shell.js";

type ProcessStatus = NonNullable<WorkProcess["status"]>;

const STATUS_CONFIG: Record<
  ProcessStatus,
  { detail: string; badgeLabel: string; badgeClass: string }
> = {
  running: {
    detail: "Running",
    badgeLabel: "Running",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
  },
  finished: {
    detail: "Completed successfully",
    badgeLabel: "OK",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
  },
  failed: {
    detail: "Failed",
    badgeLabel: "Failed",
    badgeClass: "bg-[#dc2626]/10 text-[#dc2626]",
  },
  "restart-waiting": {
    detail: "Waiting to restart",
    badgeLabel: "Restart",
    badgeClass: "bg-amber-500/10 text-amber-600",
  },
};

export function ProcessCard({ part }: { part: WorkProcess }) {
  const setOpenWorkProcess = useStore((s) => s.setOpenWorkProcess);

  const devOverride = useDevToolsState((s) => s.processStatus);
  const status: ProcessStatus =
    (import.meta.env.VITE_MOCK ? devOverride : null) ??
    part.status ??
    (part.exitCode === 0 ? "finished" : "failed");
  const config = STATUS_CONFIG[status];

  const detail =
    status === "failed" ? `Exited with code ${part.exitCode}` : config.detail;
  const badgeLabel =
    status === "failed" ? `exit ${part.exitCode}` : config.badgeLabel;

  return (
    <WorkCardShell
      title={
        <code className="font-mono text-xs font-medium">{part.command}</code>
      }
      detail={detail}
      accessory={
        <span className="flex items-center gap-1.5">
          {status === "running" && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#24a148]" />
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${config.badgeClass}`}
          >
            {badgeLabel}
          </span>
        </span>
      }
      onClick={() =>
        setOpenWorkProcess({
          command: part.command,
          exitCode: part.exitCode,
          logLines: part.logLines,
          status,
        })
      }
    />
  );
}
