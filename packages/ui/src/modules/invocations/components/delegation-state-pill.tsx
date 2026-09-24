import { Checkmark } from "@carbon/icons-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { DelegationDisplayState } from "../lib/delegation-state.js";

const pill: Record<
  DelegationDisplayState,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  working: { variant: "success", label: "Working" },
  waiting: { variant: "warning", label: "Waiting for room" },
  done: { variant: "accent", label: "Done" },
  failed: { variant: "danger", label: "Failed" },
};

interface Props {
  state: DelegationDisplayState;
}

export function DelegationStatePill({ state }: Props) {
  const { variant, label } = pill[state];
  return (
    <Badge variant={variant} size="sm" className="shrink-0 gap-1">
      {state === "done" && <Checkmark size={11} aria-hidden />}
      {label}
    </Badge>
  );
}
