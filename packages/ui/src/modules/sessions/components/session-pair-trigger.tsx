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
      className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      {...props}
    >
      {label ? (
        <>
          {harness && <HarnessIcons harnesses={[harness]} size="xs" />}
          {label}
        </>
      ) : (
        <Spinner size={12} />
      )}
    </button>
  );
}
