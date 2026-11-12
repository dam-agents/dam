import { Close } from "@carbon/icons-react";
import { useState } from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import {
  browserStorage,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import { CURVE_BENDER_DOCS_URL } from "../../providers/components/curve-bender-info-dialog.js";
import { CurveBenderRestriction } from "../../providers/components/curve-bender-restriction.js";
import { ChatColumn } from "./chat-column.js";

const DISMISSED_KEYS = {
  setup: "platform-curvebender-restricted-setup-dismissed",
  offer: "platform-curvebender-restricted-offer-dismissed",
} as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the card above a new chat's composer for whichever
 * CurveBender notice the view decided on: that variant's copy and its one
 * action — Try now on the shared Connection, or the picker — and a close of its
 * own, kept in this browser.
 */
export function CurveBenderAlert({
  variant,
  onTry,
  onPickProvider,
}: {
  variant: "setup" | "offer" | null;
  onTry: () => Promise<boolean>;
  onPickProvider: () => void;
}) {
  const [closed, setClosed] = useState<"setup" | "offer" | null>(null);
  const [trying, setTrying] = useState(false);
  if (!variant) return null;
  if (
    closed === variant ||
    safeGetItem(browserStorage, DISMISSED_KEYS[variant]) !== null
  )
    return null;
  const copy = match(variant)
    .with(
      "setup",
      () =>
        "You're set up with CurveBender, IBM-hosted open-source models. Start chatting, or switch providers anytime.",
    )
    .with(
      "offer",
      () => "You can now use CurveBender, IBM-hosted open-source models.",
    )
    .exhaustive();
  return (
    <section
      data-testid="curve-bender-alert"
      data-variant={variant}
      aria-label="CurveBender"
      className="px-4 md:px-8"
    >
      <ChatColumn>
        <div className="mb-2 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground shadow-md">
          <div className="flex items-start gap-2">
            <img
              src="/icons/curve-bender-color.svg"
              alt=""
              className="mt-1 size-4 shrink-0"
            />
            <p className="min-w-0 flex-1 text-base font-medium">CurveBender</p>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-2 -mt-1 shrink-0 text-muted-foreground"
              tooltip="Dismiss"
              aria-label="Dismiss the CurveBender notice"
              onClick={() => {
                safeSetItem(browserStorage, DISMISSED_KEYS[variant], "1");
                setClosed(variant);
              }}
            >
              <Close size={16} />
            </Button>
          </div>
          <p className="mt-1 text-sm">{copy}</p>
          <CurveBenderRestriction className="mt-1" />
          <div className="mt-2 flex items-center justify-between gap-3">
            {match(variant)
              .with("setup", () => (
                <Button
                  variant="link"
                  size="inline"
                  className="text-sm"
                  onClick={onPickProvider}
                >
                  Use a different provider
                </Button>
              ))
              .with("offer", () => (
                <Button
                  variant="link"
                  size="inline"
                  className="text-sm"
                  disabled={trying}
                  onClick={async () => {
                    setTrying(true);
                    await onTry();
                    setTrying(false);
                  }}
                >
                  Try now
                </Button>
              ))
              .exhaustive()}
            <a
              href={CURVE_BENDER_DOCS_URL}
              {...externalLinkProps}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Learn more
            </a>
          </div>
        </div>
      </ChatColumn>
    </section>
  );
}
