import { Checkmark, Copy, Launch } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

/** Bring-your-own-OAuth-app instructions: provider setup link plus the exact
 *  redirect URI to register. */
export function OAuthAppHint({
  callbackUrl,
  setupUrl,
}: {
  callbackUrl?: string;
  setupUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!callbackUrl && !setupUrl) return null;

  const copy = () => {
    if (!callbackUrl) return;
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Callout tone="muted" className="flex flex-col gap-2">
      <p className="text-[12px] text-foreground/80">
        Register an OAuth app at the provider, then paste its client credentials
        below.
        {setupUrl && (
          <>
            {" "}
            <a
              href={setupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              Create an app <Launch size={11} />
            </a>
          </>
        )}
      </p>
      {callbackUrl && (
        <div>
          <span className="text-[11px] text-muted-foreground block mb-1">
            Add this exact redirect URI to your app:
          </span>
          <div className="flex items-center gap-1.5">
            <code className="text-[11px] font-mono text-foreground/90 break-all">
              {callbackUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={copy}
              title="Copy redirect URI"
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
