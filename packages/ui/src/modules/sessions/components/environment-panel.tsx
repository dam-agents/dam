import { Close, Copy, Launch, TrashCan } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { timeUntil } from "../../../lib/format-time.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
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

export function EnvironmentPanel() {
  const data = useStore((s) => s.openEnvironment);
  const close = useStore((s) => s.setOpenEnvironment);
  const showConfirm = useStore((s) => s.showConfirm);

  if (!data) return null;

  const badge = STATUS_BADGE[data.status] ?? STATUS_BADGE.running;

  function handleExtend(days: number) {
    emitToast({
      kind: "success",
      message: `Extended "${data!.name}" by ${days} day${days !== 1 ? "s" : ""}.`,
    });
  }

  async function handleDelete() {
    const confirmed = await showConfirm(
      "This will permanently delete the environment.",
      "Delete environment",
      { kind: "destructive" },
    );
    if (!confirmed) return;
    close(null);
    emitToast({ kind: "success", message: `Deleted "${data!.name}".` });
  }

  function handleCopyUrl() {
    if (data?.url) {
      navigator.clipboard.writeText(data.url);
      emitToast({ kind: "info", message: "Copied URL to clipboard." });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {data.name}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
        >
          {badge.label}
        </span>
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

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <dl className="flex flex-col gap-3 text-sm">
          {data.url && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">URL</dt>
              <dd className="flex items-center gap-1.5 truncate text-foreground">
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:underline"
                >
                  {data.url}
                </a>
                <button
                  onClick={handleCopyUrl}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Copy URL"
                >
                  <Copy size={14} />
                </button>
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Open in new tab"
                >
                  <Launch size={14} />
                </a>
              </dd>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Access</dt>
            {/* TODO(sarah): replace with real access list */}
            <dd className="text-foreground">
              {data.accessLabel ?? "Only you"}
            </dd>
          </div>

          {data.expiresAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="flex items-center gap-2 text-foreground">
                {timeUntil(data.expiresAt)}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 text-xs">
                      Extend
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleExtend(1)}>
                      1 day
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExtend(7)}>
                      7 days
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExtend(30)}>
                      30 days
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </dd>
            </div>
          )}

          {data.items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-2"
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end border-t border-border px-4 py-3">
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <TrashCan size={14} />
          Delete environment
        </Button>
      </div>
    </div>
  );
}
