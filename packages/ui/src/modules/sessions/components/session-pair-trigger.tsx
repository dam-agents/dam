import { ChevronDown } from "@carbon/icons-react";
import type { ComponentProps } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a pick on a config page, where there is room for
 * it: a row card naming what the page runs on, with the values below it.
 */
export function SessionPairRowTrigger({
  label,
  title,
  subtitle,
  harness,
  testId = "session-pair-row-picker",
  ...props
}: ComponentProps<"button"> & {
  /** UNIT_BOUNDARY_DESCRIPTION: the section's own label, which names what this button picks to a screen reader: the text above it is not associated with it. */
  label?: string | undefined;
  title: string;
  subtitle: string;
  harness?: string | undefined;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label ? `${label}: ${title}. ${subtitle}` : undefined}
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "flex w-full min-w-0 items-center gap-3 p-4 text-left disabled:pointer-events-none disabled:opacity-60",
      )}
      {...props}
    >
      <span className="flex shrink-0">
        <HarnessIcons harnesses={harness ? [harness] : []} focusable={false} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-md font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 truncate text-sm text-muted-foreground">
          {subtitle}
        </span>
      </span>
      {!props.disabled && (
        <ChevronDown size={16} aria-hidden className="shrink-0" />
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
