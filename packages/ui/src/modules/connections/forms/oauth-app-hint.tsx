import { Checkmark, Copy, Launch } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useCopy } from "@/hooks/use-copy";
import { externalLinkProps } from "@/lib/external-link";

export function OAuthAppHint({
  callbackUrl,
  setupUrl,
}: {
  callbackUrl?: string;
  setupUrl?: string;
}) {
  const { copy: copyText, copied } = useCopy();
  if (!callbackUrl && !setupUrl) return null;

  const copy = () => {
    if (callbackUrl) void copyText(callbackUrl);
  };

  return (
    <Callout tone="muted" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Register an OAuth app at the provider, then paste its client credentials
        below.
        {setupUrl && (
          <>
            {" "}
            <a
              href={setupUrl}
              {...externalLinkProps}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Create an app <Launch size={11} />
            </a>
          </>
        )}
      </p>
      {callbackUrl && (
        <div>
          <span className="text-xs text-muted-foreground block mb-1">
            Add this exact redirect URI to your app:
          </span>
          <div className="flex items-center gap-1.5">
            <code className="text-xs font-mono text-foreground/90 break-all">
              {callbackUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={copy}
              aria-label="Copy redirect URI"
              tooltip="Copy redirect URI"
            >
              {copied ? (
                <Checkmark size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </Button>
          </div>
        </div>
      )}
    </Callout>
  );
}
