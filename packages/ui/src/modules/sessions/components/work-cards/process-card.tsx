import { useStore } from "../../../../store.js";
import type { WorkProcess } from "../../../../types.js";
import { WorkCardShell } from "./work-card-shell.js";

const PROCESS_KIND_LABEL: Record<string, string> = {
  "harness-task": "Background task",
  detached: "Detached",
  "startup-item": "Login item",
};

type CardStatus = NonNullable<WorkProcess["status"]>;

interface StatusConfig {
  label: string;
  badgeClass: string;
  dot?: boolean;
}

const STATUS_CONFIG: Record<CardStatus, StatusConfig> = {
  running: {
    label: "Running",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  "running-awake": {
    label: "Keeping it awake",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  "running-hibernates": {
    label: "Running",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  exited: {
    label: "Exited",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
  },
  stopped: {
    label: "Stopped",
    badgeClass: "bg-muted text-muted-foreground",
  },
  hibernated: {
    label: "Hibernated",
    badgeClass: "bg-muted text-muted-foreground",
  },
};

export function ProcessCard({ part }: { part: WorkProcess }) {
  const setOpenWorkProcess = useStore((s) => s.setOpenWorkProcess);

  const status: CardStatus = part.status ?? "running";
  const config = STATUS_CONFIG[status];

  const kindLabel = part.processKind
    ? PROCESS_KIND_LABEL[part.processKind]
    : null;

  const isExitError =
    status === "exited" && part.exitCode !== undefined && part.exitCode !== 0;

  const badgeLabel = isExitError ? `exit ${part.exitCode}` : config.label;
  const badgeClass = isExitError
    ? "bg-[#dc2626]/10 text-[#dc2626]"
    : config.badgeClass;

  const title = part.container?.id ?? part.command;

  return (
    <WorkCardShell
      title={<code className="font-mono text-xs font-medium">{title}</code>}
      detail={kindLabel}
      accessory={
        <span className="flex items-center gap-1.5">
          {config.dot && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#24a148]" />
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}
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
