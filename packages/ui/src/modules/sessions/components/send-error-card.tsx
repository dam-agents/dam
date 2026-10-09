import { Warning } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { describeSendError } from "../../acp/errors.js";
import { QuietNotice } from "./quiet-notice.js";

interface Props {
  rawError: string;
  interrupted?: boolean;
  quiet?: boolean;
}

export function SendErrorCard({ rawError, interrupted, quiet }: Props) {
  const { message, hint } = describeSendError(rawError);
  if (interrupted && quiet) {
    return (
      <QuietNotice testId="prompt-delivery-error">
        Response interrupted: {message}
      </QuietNotice>
    );
  }
  return (
    <Callout
      tone="danger"
      className={cn(
        "flex max-w-[620px] items-start gap-2.5 anim-in",
        interrupted && "mt-2",
      )}
      role="alert"
      data-testid="prompt-delivery-error"
    >
      <Warning size={16} className="text-danger shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="text-sm text-foreground break-words">
          <span className="font-bold text-danger">
            {interrupted ? "Response interrupted:" : "Send failed:"}
          </span>{" "}
          {message}
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground break-words">{hint}</p>
        )}
      </div>
    </Callout>
  );
}
