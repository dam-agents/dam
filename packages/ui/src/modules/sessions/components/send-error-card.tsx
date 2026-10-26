import { Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { describeSendError } from "../../acp/errors.js";

interface Props {
  rawError: string;
  agentId?: string;
  interrupted?: boolean;
  quiet?: boolean;
}

export function SendErrorCard({
  rawError,
  agentId,
  interrupted,
  quiet,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { message, hint, needsModel } = describeSendError(rawError);
  if (interrupted && quiet) {
    return (
      <p
        className="mt-1 flex max-w-[620px] items-start gap-1.5 text-xs text-muted-foreground break-words"
        data-testid="prompt-delivery-error"
      >
        <Warning size={12} className="shrink-0 mt-0.5" />
        <span>Response interrupted: {message}</span>
      </p>
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
        {needsModel && agentId && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => navigateToSandboxHome(agentId, "setup")}
          >
            Pick a model
          </Button>
        )}
      </div>
    </Callout>
  );
}
