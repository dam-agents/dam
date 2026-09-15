import {
  OverflowMenuVertical,
  Settings,
  ShieldAlert,
} from "@carbon/icons-react";
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
  resolvedLabel?: string | null;
  onResolved?: (label: string) => void;
}

export function NotificationApprovalRow({
  approval,
  agentName,
  meta,
  onDismiss,
  resolvedLabel = null,
  onResolved,
}: Props) {
  const { actions, inflight, hostLabel, expiredNote, openSettings } =
    useApprovalActions(approval);
  const [ownResolved, setOwnResolved] = useState<string | null>(null);
  const resolved = resolvedLabel ?? ownResolved;

  const allowOnce = actions.find((a) => a.id === "allow-once");
  const rest = actions.filter((a) => a.id !== "allow-once");

  const act = async (run: () => Promise<boolean>, label: string) => {
    if (!(await run())) return;
    setOwnResolved(label);
    onResolved?.(label);
  };

  return (
    <div
      data-testid="notification-approval-row"
      className="group flex w-full gap-3 rounded-xl px-3 py-3 text-left"
    >
      <div className="relative shrink-0 pt-0.5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <ShieldAlert size={16} />
        </div>
        {!resolved && (
          <span className="absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background bg-warning" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          <span className="font-semibold text-foreground">{agentName}</span>
          <span className="text-muted-foreground">
            {" "}
            {approvalHeadline(approval).toLowerCase()}
          </span>
        </p>

        <p className="mt-0.5 truncate font-mono text-sm text-muted-foreground/70">
          {approvalDetail(approval)}
        </p>

        {expiredNote && (
          <p className="mt-1 text-sm text-muted-foreground">{expiredNote}</p>
        )}

        {resolved ? (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium",
                resolved.startsWith("Denied")
                  ? "bg-[#fff1f1] text-destructive dark:bg-destructive/15"
                  : "bg-[#defbe6] text-success dark:bg-success/15",
              )}
            >
              {resolved}
            </span>
            {hostLabel !== null && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    aria-label="More actions"
                  >
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={openSettings}>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : expiredNote ? (
          <div className="mt-2 flex items-center gap-2">
            {hostLabel !== null && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    aria-label="More actions"
                  >
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={openSettings}>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            {allowOnce && (
              <Button
                size="sm"
                disabled={allowOnce.disabled}
                tooltip={allowOnce.tooltip}
                onClick={(event) => {
                  event.stopPropagation();
                  void act(allowOnce.run, allowOnce.resolvedLabel);
                }}
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
              <DropdownMenuContent align="start">
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

      <div className="flex shrink-0 items-start pt-0.5">
        <span className="text-sm text-muted-foreground">{meta}</span>
        <button
          type="button"
          onClick={onDismiss}
          title="Hides this from notifications. The request stays pending."
          className="ml-3 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
