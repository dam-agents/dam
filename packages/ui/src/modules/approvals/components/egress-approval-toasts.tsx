import {
  Checkmark,
  Close,
  Globe,
  Locked,
  Security,
  Settings,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";
import { useApprovalsForOwner } from "../api/queries.js";

const EMPTY: never[] = [];

const FOREIGN_TOAST_MS = 60_000;

/** Upper-right egress-approval toast stack. The viewed sandbox's toasts stay
 *  until acted on; foreign ones hide after a timeout but the row stays
 *  pending in the Inbox — same polled rows, same verdict mutations. */
export function EgressApprovalToasts({ agentId }: { agentId: string | null }) {
  const { data: rows = EMPTY } = useApprovalsForOwner();
  const pendingEgress = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.type === "ext_authz"),
    [rows],
  );

  // `hidden` is ignored for the viewed sandbox, so a row hidden while
  // foreign resurfaces when its sandbox is opened.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    for (const row of pendingEgress) {
      if (row.agentId === agentId || timers.current.has(row.id)) continue;
      timers.current.set(
        row.id,
        setTimeout(
          () => setHidden((prev) => new Set(prev).add(row.id)),
          FOREIGN_TOAST_MS,
        ),
      );
    }
  }, [pendingEgress, agentId]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const visible = pendingEgress.filter(
    (r) => r.agentId === agentId || !hidden.has(r.id),
  );
  if (visible.length === 0) return null;

  // Collapsed by default: the newest toast in front, the rest peeking out
  // beneath it; hovering the stack expands it to the full column.
  return (
    <div className="group absolute top-4 right-4 z-40 w-[400px] max-w-[calc(100vw-32px)]">
      {visible.map((row, i) => (
        <div
          key={row.id}
          style={
            {
              zIndex: visible.length - i,
              "--stack-y": `${Math.min(i, 3) * 12}px`,
              "--stack-scale": `${1 - Math.min(i, 3) * 0.03}`,
            } as CSSProperties
          }
          className={cn(
            "relative transition-all duration-200",
            i > 0 &&
              "absolute inset-x-0 top-0 origin-top [transform:translateY(var(--stack-y))_scale(var(--stack-scale))] group-hover:static group-hover:mt-3 group-hover:[transform:none]",
          )}
        >
          <EgressApprovalToast row={row} foreign={row.agentId !== agentId} />
        </div>
      ))}
    </div>
  );
}

function EgressApprovalToast({
  row,
  foreign,
}: {
  row: ApprovalView;
  foreign: boolean;
}) {
  const { data: agentsData } = useAgents();
  const agentName =
    agentsData?.list.find((a) => a.id === row.agentId)?.name ?? row.agentId;
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxSettings = useStore(
    (s) => s.navigateToSandboxSettings,
  );

  if (row.payload.kind !== "ext_authz") return null;
  const { host, method, path } = row.payload;
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  return (
    <div
      data-testid="egress-approval-toast"
      className="rounded-xl border border-border-light bg-background shadow-lg p-4 flex flex-col gap-3 anim-in"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        {foreign && (
          <span className="pl-4 text-[12px] text-muted-foreground truncate">
            {agentName}
          </span>
        )}
        <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
          <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
          <span className="truncate">
            {method} {host}
          </span>
        </div>
        <span className="pl-4 text-[14px] text-muted-foreground truncate">
          {path}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-[14px] font-medium"
          disabled={inflight}
          onClick={() => approveOnce.mutate({ id: row.id })}
        >
          <Checkmark size={14} /> Allow once
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-[14px] font-medium"
          disabled={inflight}
          onClick={() => approvePermanent.mutate({ id: row.id })}
        >
          <Security size={14} /> Always allow this request
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-[14px] font-medium"
          disabled={inflight}
          onClick={() => approveHost.mutate({ id: row.id })}
        >
          <Globe size={14} /> Always allow this host
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-[14px] font-medium"
          disabled={inflight}
          onClick={() => dismiss.mutate({ id: row.id })}
          title="Deny this single request — re-prompts on the next attempt"
        >
          <Close size={14} /> Deny once
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-[14px] font-medium"
          disabled={inflight}
          onClick={() => denyForever.mutate({ id: row.id })}
          title="Deny this exact path on this host (writes a deny rule)"
        >
          <Locked size={14} /> Always deny this request
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-[14px] font-medium"
          disabled={inflight}
          onClick={() => navigateToSandboxSettings(row.agentId)}
          title="Open this sandbox's settings"
        >
          <Settings size={14} /> Customize…
        </Button>
      </div>
    </div>
  );
}
