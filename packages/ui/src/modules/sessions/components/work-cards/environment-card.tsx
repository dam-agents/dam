import { CloudApp } from "@carbon/icons-react";

import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { EnvironmentStatus, WorkEnvironment } from "../../../../types.js";
import { WorkCardShell } from "./work-card-shell.js";

const STATUS_DETAIL: Record<EnvironmentStatus, string> = {
  starting: "Starting…",
  running: "Running",
  expired: "Expired",
  deleted: "Deleted",
};

const STATUS_BADGE: Record<
  EnvironmentStatus,
  { label: string; className: string }
> = {
  starting: {
    label: "Starting",
    className: "bg-amber-500/10 text-amber-600",
  },
  running: {
    label: "Running",
    className: "bg-[#24a148]/10 text-[#24a148]",
  },
  expired: {
    label: "Expired",
    className: "bg-muted text-muted-foreground",
  },
  deleted: {
    label: "Deleted",
    className: "bg-[#dc2626]/10 text-[#dc2626]",
  },
};

export function EnvironmentCard({ part }: { part: WorkEnvironment }) {
  const setOpenEnvironment = useStore((s) => s.setOpenEnvironment);
  const devOverride = useDevToolsState((s) => s.environmentStatus);
  const status: EnvironmentStatus =
    (import.meta.env.VITE_MOCK ? devOverride : null) ??
    part.status ??
    "running";
  const badge = STATUS_BADGE[status];

  return (
    <WorkCardShell
      icon={<CloudApp size={16} />}
      title={part.name ?? "Environment"}
      detail={STATUS_DETAIL[status]}
      accessory={
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
        >
          {badge.label}
        </span>
      }
      onClick={() =>
        setOpenEnvironment({
          name: part.name ?? "Environment",
          status,
          url: part.url,
          expiresAt: part.expiresAt,
          accessLabel: part.accessLabel,
          items: part.items,
        })
      }
    />
  );
}
