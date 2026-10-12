import { Launch } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { CopyButton } from "@/components/ui/copy-button";
import { externalLinkProps } from "@/lib/external-link";

export function OAuthAppHint({
  callbackUrl,
  setupUrl,
}: {
  callbackUrl?: string;
  setupUrl?: string;
}) {
  if (!callbackUrl && !setupUrl) return null;

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
            <CopyButton value={callbackUrl} label="Copy redirect URI" />
          </div>
        </div>
      )}
    </Callout>
  );
}
