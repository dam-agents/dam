import {
  Chat,
  Close,
  Edit,
  Launch,
  Locked,
  OverflowMenuVertical,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { ShareEnvironmentDialog } from "./work-cards/share-environment-dialog.js";

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "muted" | "danger" }
> = {
  starting: { label: "Starting", variant: "warning" },
  running: { label: "Running", variant: "success" },
  expired: { label: "Expired", variant: "muted" },
  deleted: { label: "Deleted", variant: "danger" },
};

const mockAppHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Reports</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#161616;font-size:13px}
.header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e0e0e0}
.header h1{font-size:15px;font-weight:600}
.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:12px;cursor:pointer;color:#161616;font-weight:500}
.btn:hover{background:#f4f4f4}
.btn-primary{background:#0f62fe;color:#fff;border-color:#0f62fe}
.btn-primary:hover{background:#0353e9}
.tabs{display:flex;gap:0;border-bottom:1px solid #e0e0e0;padding:0 16px}
.tab{padding:10px 14px;font-size:12px;font-weight:500;color:#525252;border-bottom:2px solid transparent;cursor:pointer}
.tab.active{color:#0f62fe;border-bottom-color:#0f62fe}
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #e0e0e0}
.search{flex:1;padding:6px 10px;border:1px solid #e0e0e0;border-radius:6px;font-size:12px;background:#f4f4f4}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:8px 16px;font-size:11px;font-weight:600;color:#525252;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e0e0e0;background:#f4f4f4}
td{padding:8px 16px;font-size:12px;border-bottom:1px solid #f4f4f4}
tr:hover td{background:#f9f9f9}
.status{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;padding:2px 8px;border-radius:10px}
.status-done{background:#defbe6;color:#0e6027}
.status-running{background:#d0e2ff;color:#0043ce}
.status-queued{background:#f4f4f4;color:#525252}
.footer{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid #e0e0e0;color:#525252;font-size:11px}
.note{margin:12px 16px;padding:10px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#f4f4f4;font-size:11px;color:#525252;line-height:1.5}
</style>
</head>
<body>
<div class="header">
  <h1>Reports</h1>
  <div style="display:flex;gap:6px">
    <button class="btn" onclick="alert('CSV download started')">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1v9m0 0L5 7m3 3l3-3M2 12v2h12v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Download CSV
    </button>
    <button class="btn btn-primary">+ New report</button>
  </div>
</div>
<div class="tabs">
  <div class="tab active">All reports</div>
  <div class="tab">Scheduled</div>
  <div class="tab">Archived</div>
</div>
<div class="toolbar">
  <input class="search" placeholder="Search reports…" />
  <button class="btn">Filter</button>
  <button class="btn">Sort</button>
</div>
<table>
  <thead>
    <tr><th>Name</th><th>Type</th><th>Status</th><th>Last run</th><th>Records</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>Q3 Revenue Summary</strong></td><td>Financial</td><td><span class="status status-done">Complete</span></td><td>2 hours ago</td><td>14,230</td></tr>
    <tr><td><strong>User Growth Weekly</strong></td><td>Analytics</td><td><span class="status status-done">Complete</span></td><td>6 hours ago</td><td>8,412</td></tr>
    <tr><td><strong>Infrastructure Costs</strong></td><td>Financial</td><td><span class="status status-running">Running</span></td><td>In progress</td><td>—</td></tr>
    <tr><td><strong>API Usage by Team</strong></td><td>Usage</td><td><span class="status status-done">Complete</span></td><td>1 day ago</td><td>52,891</td></tr>
    <tr><td><strong>Monthly Active Users</strong></td><td>Analytics</td><td><span class="status status-queued">Queued</span></td><td>Scheduled 5pm</td><td>—</td></tr>
    <tr><td><strong>Storage Audit</strong></td><td>Compliance</td><td><span class="status status-done">Complete</span></td><td>3 days ago</td><td>3,102</td></tr>
  </tbody>
</table>
<div class="footer">
  <span>6 reports</span>
  <span>Showing 1–6 of 6</span>
</div>
<div class="note">
  Environments are configured in the Agent Configure page. Managing access is only available through here.
</div>
</body>
</html>`;

export function EnvironmentPanel() {
  const data = useStore((s) => s.openEnvironment);
  const close = useStore((s) => s.setOpenEnvironment);
  const showConfirm = useStore((s) => s.showConfirm);
  const [shareOpen, setShareOpen] = useState(false);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-foreground">
          {data.name}
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${badge.variant === "success" ? "bg-[#24a148] dark:bg-[#42be65]" : badge.variant === "warning" ? "bg-[#f1c21b]" : badge.variant === "danger" ? "bg-[#da1e28]" : "bg-[#697077]"}`}
          />
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1 text-xs text-muted-foreground"
          onClick={() => setShareOpen(true)}
        >
          {!data.accessLabel ||
          data.accessLabel.toLowerCase() === "private" ||
          data.accessLabel.toLowerCase() === "only you" ? (
            <>
              <Locked size={12} />
              Private
            </>
          ) : (
            <>
              <Share size={12} />
              {data.accessLabel}
            </>
          )}
          {data.expiresAt &&
            (() => {
              const ms = new Date(data.expiresAt).getTime() - Date.now();
              if (ms <= 0)
                return (
                  <>
                    <span className="mx-0.5">·</span>Expired
                  </>
                );
              const days = Math.ceil(ms / 86_400_000);
              return (
                <>
                  <span className="mx-0.5">·</span>Expires in {days}{" "}
                  {days === 1 ? "day" : "days"}
                </>
              );
            })()}
        </Button>
        {data.url && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Open in new tab"
            tooltip="Open in new tab"
            onClick={() => window.open(data.url, "_blank", "noopener")}
          >
            <Launch size={16} />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label="More actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                emitToast({
                  kind: "info",
                  message: "Ask agent to edit (placeholder)",
                })
              }
            >
              <Chat size={13} /> Ask agent to edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                emitToast({ kind: "info", message: "Rename (placeholder)" })
              }
            >
              <Edit size={13} /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleExtend(1)}>
              Extend expiry 1 day
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleExtend(7)}>
              Extend expiry 7 days
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleExtend(30)}>
              Extend expiry 30 days
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              <TrashCan size={13} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      {/* Mock app preview */}
      <iframe
        title={`${data.name} preview`}
        sandbox="allow-scripts"
        srcDoc={mockAppHtml}
        className="min-h-0 flex-1 bg-white"
      />
      {shareOpen && (
        <ShareEnvironmentDialog
          name={data.name}
          accessLabel={data.accessLabel}
          expiresAt={data.expiresAt}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
