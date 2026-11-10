import { Checkmark, StopFilledAlt } from "@carbon/icons-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { DelegationDisplayState } from "../lib/delegation-state.js";

const pill: Record<
  DelegationDisplayState,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  working: { variant: "success", label: "Working" },
  waiting: { variant: "warning", label: "Waiting for room" },
  done: { variant: "accent", label: "Done" },
  failed: { variant: "danger", label: "Failed" },
  stopped: { variant: "muted", label: "Stopped" },
};

interface Props {
  state: DelegationDisplayState;
  className?: string;
}

export function DelegationStatePill({ state, className }: Props) {
  const { variant, label } = pill[state];
  return (
    <Badge
      variant={variant}
      size="sm"
      className={cn("shrink-0 gap-1", className)}
    >
      {state === "done" && <Checkmark size={11} aria-hidden />}
      {state === "stopped" && <StopFilledAlt size={9} aria-hidden />}
      {label}
    </Badge>
  );
}
