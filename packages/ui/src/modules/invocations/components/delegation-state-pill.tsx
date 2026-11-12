import { Checkmark, StopFilledAlt } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { DelegationDisplayState } from "../lib/delegation-state.js";

const pill: Record<
  DelegationDisplayState,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  working: { variant: "success", label: "Working" },
  waiting: { variant: "warning", label: "Waiting for room" },
  "waiting-for-owner": { variant: "warning", label: "Waiting for you" },
  done: { variant: "accent", label: "Done" },
  failed: { variant: "danger", label: "Failed" },
  stopped: { variant: "muted", label: "Stopped" },
};

const WITH_STOP = "items-stretch overflow-hidden p-0";
const LABEL = "flex items-center gap-1 px-1.5 py-0.5";

interface Props {
  state: DelegationDisplayState;
  stop?: ReactNode;
}

// UNIT_BOUNDARY_DESCRIPTION: a delegation's state in one pill, and the one home of the pills' colours: a `stop` joins the pill as its last segment, in the pill's own colour.
export function DelegationStatePill({ state, stop }: Props) {
  const { variant, label } = pill[state];
  return (
    <Badge
      variant={variant}
      size="sm"
      className={cn("shrink-0", stop ? WITH_STOP : "gap-1")}
    >
      <span className={stop ? LABEL : "contents"}>
        {state === "done" && <Checkmark size={11} aria-hidden />}
        {state === "stopped" && <StopFilledAlt size={9} aria-hidden />}
        {label}
      </span>
      {stop}
    </Badge>
  );
}

export function SubAgentsWorkingPill({
  count,
  stop,
}: {
  count: number;
  stop: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(
        "shrink-0 border-success text-green-700 dark:text-success",
        WITH_STOP,
      )}
    >
      <span className={LABEL}>
        {count} sub-agent{count === 1 ? "" : "s"} working
      </span>
      {stop}
    </Badge>
  );
}
