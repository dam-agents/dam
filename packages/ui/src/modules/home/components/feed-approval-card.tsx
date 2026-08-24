import { OverflowMenuVertical, Settings } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { approvalDetail, approvalHeadline } from "../lib/approval-copy.js";

interface Props {
  approval: ApprovalView;
  agentName: string;
  meta: string;
  onDismiss: () => void;
  onResolved?: () => void;
}

export function FeedApprovalCard({
  approval,
  agentName,
  meta,
  onDismiss,
  onResolved,
}: Props) {
  const { actions, inflight, hostLabel, expiredNote, openSettings } =
    useApprovalActions(approval);
  const [resolved, setResolved] = useState<string | null>(null);

  const allowOnce = actions.find((a) => a.id === "allow-once");
  const rest = actions.filter((a) => a.id !== "allow-once");

  const act = async (run: () => Promise<boolean>, resolvedLabel: string) => {
    if (!(await run())) return;
    setResolved(resolvedLabel);
    onResolved?.();
  };

  return (
    <div
      data-testid="feed-approval-card"
      className="group w-full rounded-2xl border border-border bg-card/80 p-5 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {!resolved && (
              <span className="size-2 shrink-0 rounded-full bg-warning" />
            )}
            <span className="truncate">{agentName}</span>
          </div>
          <p className="text-[15px] leading-snug font-semibold text-foreground">
            {approvalHeadline(approval)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="Hides this from Home. The request stays pending — resolve it in the session."
          className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono text-sm text-muted-foreground">
          {approvalDetail(approval)}
        </span>
      </div>

      {expiredNote && (
        <p className="mt-2 text-sm text-muted-foreground">{expiredNote}</p>
      )}

      <div className="-mx-5 -mb-5 mt-3 flex items-center justify-between border-t border-border px-5 py-2.5">
        <span className="text-sm text-muted-foreground">{meta}</span>
        {resolved ? (
          <span
            className={cn(
              "text-sm",
              resolved.startsWith("Denied")
                ? "text-destructive"
                : "text-success",
            )}
          >
            {resolved}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {allowOnce && (
              <Button
                size="sm"
                disabled={allowOnce.disabled}
                tooltip={allowOnce.tooltip}
                onClick={() => void act(allowOnce.run, allowOnce.resolvedLabel)}
              >
                Allow
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-2"
                  disabled={inflight}
                  aria-label="More approval actions"
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {rest.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    disabled={action.disabled}
                    className={action.danger ? "text-destructive" : undefined}
                    onSelect={() => void act(action.run, action.resolvedLabel)}
                    title={action.tooltip}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
                {hostLabel !== null && (
                  <>
                    <DropdownMenuSeparator className="-mx-1" />
                    <DropdownMenuItem onSelect={openSettings}>
                      <Settings size={16} />
                      Network settings
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
