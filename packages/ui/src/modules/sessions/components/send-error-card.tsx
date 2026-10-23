import { Warning } from "@carbon/icons-react";
import { AUTH_ERROR_HINT_LINK_TEXT } from "api-server-api";
import type { MouseEvent, ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { describeSendError } from "../../acp/errors.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { QuietNotice } from "./quiet-notice.js";

interface Props {
  rawError: string;
  interrupted?: boolean;
  quiet?: boolean;
}

function ProvidersSettingsLink() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigateToSettings("providers");
  }
  return (
    <a
      href={routeToPath({ view: "settings", settingsTab: "providers" })}
      onClick={handleClick}
      className={cn(
        "text-accent underline underline-offset-2 hover:no-underline rounded-xs",
        FOCUS_RING,
      )}
    >
      {AUTH_ERROR_HINT_LINK_TEXT}
    </a>
  );
}

function withProvidersLink(text: string): ReactNode {
  const at = text.indexOf(AUTH_ERROR_HINT_LINK_TEXT);
  if (at < 0) return text;
  const end = at + AUTH_ERROR_HINT_LINK_TEXT.length;
  return (
    <>
      {text.slice(0, at)}
      <ProvidersSettingsLink />
      {text.slice(end)}
    </>
  );
}

export function SendErrorCard({ rawError, interrupted, quiet }: Props) {
  const { title, message, hint } = describeSendError(rawError);
  if (interrupted && quiet) {
    return (
      <QuietNotice testId="prompt-delivery-error">
        {title ?? "Response interrupted:"} {message}
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
            {title ?? (interrupted ? "Response interrupted:" : "Send failed:")}
          </span>{" "}
          {withProvidersLink(message)}
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground break-words">
            {withProvidersLink(hint)}
          </p>
        )}
      </div>
    </Callout>
  );
}
