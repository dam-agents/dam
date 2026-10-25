import { Launch, Warning } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useProviderErrorCopy } from "../hooks/use-provider-error-copy.js";
import { ErrorActions } from "./error-actions.js";

interface Props {
  rawError: string;
  templateId: string | null;
  agentId: string | null;
  interrupted: boolean;
  onRetry?: () => void;
  menu?: ReactNode;
  className?: string;
}

export function ProviderErrorCard({
  rawError,
  templateId,
  agentId,
  interrupted,
  onRetry,
  menu,
  className,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { title, message, hint, statusLink } = useProviderErrorCopy(
    templateId,
    interrupted,
  );
  return (
    <Callout
      tone="danger"
      role="alert"
      data-testid="provider-error-card"
      className={cn(
        "flex w-full max-w-[620px] items-start gap-2.5 anim-in",
        className,
      )}
    >
      <Warning size={16} className="text-danger shrink-0 mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-sm text-foreground break-words">
          <span className="font-bold text-danger">{title}</span> {message}
        </div>
        <p className="text-xs text-muted-foreground break-words">{hint}</p>
        <ErrorActions rawError={rawError} onRetry={onRetry}>
          {statusLink && (
            <Button asChild variant="outline" size="sm">
              <a
                href={statusLink.url}
                {...externalLinkProps}
                data-testid="provider-status-link"
              >
                {statusLink.name} status
                <Launch size={16} />
              </a>
            </Button>
          )}
          {agentId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateToSandboxHome(agentId, "models")}
              data-testid="send-error-switch-provider"
            >
              Switch provider
            </Button>
          )}
        </ErrorActions>
      </div>
      {menu}
    </Callout>
  );
}
