import { Close, Information } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import {
  useAssistantNotice,
  useDismissAssistantNotice,
} from "../api/assistant-notice.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one-time news that an Agent the owner already
 * had now carries another name, because the reserved one became their
 * assistant's. It is shown on Home until they dismiss it.
 */
export function AssistantRenameNotice() {
  const { data } = useAssistantNotice();
  const dismiss = useDismissAssistantNotice();
  if (!data) return null;
  return (
    <Callout
      tone="info"
      size="sm"
      role="note"
      className="mb-6 flex items-start gap-2.5 text-sm"
      data-testid="assistant-rename-notice"
    >
      <Information size={16} className="mt-0.5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold text-foreground">
          Your agent “{data.renamedFrom}” is now “{data.renamedTo}”.
        </strong>{" "}
        <span className="text-muted-foreground">
          {data.renamedFrom} is your assistant now, and that name is its own.
        </span>
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        tooltip="Dismiss"
        onClick={() => dismiss.mutate()}
        className="shrink-0 text-muted-foreground"
      >
        <Close size={16} />
      </Button>
    </Callout>
  );
}
