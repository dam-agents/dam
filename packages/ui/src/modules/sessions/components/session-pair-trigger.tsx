import { ChevronDown } from "@carbon/icons-react";
import type { ComponentProps } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Spinner } from "@/components/ui/spinner";

export function SessionPairTrigger({
  label,
  testId = "session-pair-picker",
  harness,
  ...props
}: ComponentProps<"button"> & {
  label: string | undefined;
  testId?: string;
  harness?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-busy={label ? undefined : true}
      aria-label={label ? undefined : "Loading harness and model"}
      title={label}
      className="flex min-w-0 items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      {...props}
    >
      {label ? (
        <>
          <PairSummary harness={harness} label={label} />
          {!props.disabled && (
            <ChevronDown size={12} aria-hidden className="shrink-0" />
          )}
        </>
      ) : (
        <Spinner size={12} />
      )}
    </button>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a pick as one line, the harness icon before its `pairSummary`. */
export function PairSummary({
  harness,
  label,
}: {
  harness?: string | undefined;
  label: string;
}) {
  return (
    <>
      {harness && (
        <span className="flex shrink-0">
          <HarnessIcons harnesses={[harness]} size="xs" />
        </span>
      )}
      <span className="truncate">{label}</span>
    </>
  );
}
