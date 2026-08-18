import {
  Checkmark,
  Close,
  Globe,
  Locked,
  Security,
  Settings,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";
import { useEgressApprovalRestart } from "../lib/egress-approval-restart.js";
import { isHeldCallStillLive } from "../lib/hold.js";

export function EgressApprovalToast({
  row,
  foreign,
}: {
  row: ApprovalView;
  foreign: boolean;
}) {
  const agentName = useAgentDisplayName(row.agentId);
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const restart = useEgressApprovalRestart(row);

  if (row.payload.kind !== "ext_authz") return null;
  const { host, method, path } = row.payload;
  const live = isHeldCallStillLive(row);
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  return (
    <div
      data-testid="egress-approval-toast"
      className="rounded-xl border border-border bg-background shadow-lg p-4 flex flex-col gap-3 anim-in"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        {foreign && (
          <span className="pl-4 text-xs text-muted-foreground truncate">
            {agentName}
          </span>
        )}
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
          <span className="truncate">
            {method} {host}
          </span>
        </div>
        <span className="pl-4 text-sm text-muted-foreground truncate">
          {path}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-sm font-medium"
          disabled={inflight || !live}
          onClick={() => approveOnce.mutate({ id: row.id })}
          tooltip={
            live
              ? undefined
              : "Original request already failed; pick an Always option to allow future retries"
          }
        >
          <Checkmark size={14} /> Allow once
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-sm font-medium"
          disabled={inflight}
          onClick={() => {
            void restart
              .confirmNarrow("Allow & restart")
              .then((ok) => ok && approvePermanent.mutate({ id: row.id }));
          }}
          tooltip={restart.permanentTooltip}
        >
          <Security size={14} /> Always allow this request
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] bg-background text-sm font-medium"
          disabled={inflight}
          onClick={() => {
            void restart
              .confirmHost("Allow & restart")
              .then((ok) => ok && approveHost.mutate({ id: row.id }));
          }}
          tooltip={restart.allowHostTooltip}
        >
          <Globe size={14} /> Always allow this host
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-sm font-medium"
          disabled={inflight || !live}
          onClick={() => dismiss.mutate({ id: row.id })}
          tooltip={
            live
              ? "Deny this single request — re-prompts on the next attempt"
              : "Original request already failed; nothing to deny"
          }
        >
          <Close size={14} /> Deny once
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-sm font-medium"
          disabled={inflight}
          onClick={() => {
            void restart
              .confirmNarrow("Deny & restart")
              .then((ok) => ok && denyForever.mutate({ id: row.id }));
          }}
          tooltip={restart.denyForeverTooltip}
        >
          <Locked size={14} /> Always deny this request
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-[26px] text-sm font-medium"
          disabled={inflight}
          onClick={() => navigateToSandboxHome(row.agentId)}
          tooltip="Open this sandbox's settings"
        >
          <Settings size={14} /> Customize…
        </Button>
      </div>
    </div>
  );
}
