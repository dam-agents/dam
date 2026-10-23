import { Close } from "@carbon/icons-react";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import {
  browserStorage,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import { CURVE_BENDER_DOCS_URL } from "../../providers/components/curve-bender-info-dialog.js";
import { ChatColumn } from "./chat-column.js";

const DISMISSED_KEY = "platform-curvebender-alert-dismissed";
const COMMUNITY_URL = "https://ibm.enterprise.slack.com/archives/C0C3E4VJAR1";

export function CurveBenderAlert({
  visible,
  onTry,
}: {
  visible: boolean;
  onTry: () => Promise<boolean>;
}) {
  const [dismissed, setDismissed] = useState(
    () => safeGetItem(browserStorage, DISMISSED_KEY) !== null,
  );
  const [thanks, setThanks] = useState(false);
  const [trying, setTrying] = useState(false);
  if (!visible || dismissed) return null;
  return (
    <>
      <section
        data-testid="curve-bender-alert"
        aria-label="CurveBender"
        className="px-4 md:px-8"
      >
        <ChatColumn>
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/10">
              <img
                src="/icons/curve-bender-color.svg"
                alt=""
                className="size-6"
              />
            </span>
            <p className="min-w-0 flex-1">
              <a
                href={CURVE_BENDER_DOCS_URL}
                {...externalLinkProps}
                className="font-medium text-accent underline underline-offset-2"
              >
                CurveBender
              </a>{" "}
              now provides {getBrand().name} with open-source models on IBM
              infra.
            </p>
            <Button
              variant="link"
              size="inline"
              className="shrink-0"
              disabled={trying}
              onClick={async () => {
                setTrying(true);
                const applied = await onTry();
                setTrying(false);
                setThanks(applied);
              }}
            >
              Try now
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 shrink-0 text-muted-foreground"
              tooltip="Dismiss"
              aria-label="Dismiss the CurveBender notice"
              onClick={() => {
                safeSetItem(browserStorage, DISMISSED_KEY, "1");
                setDismissed(true);
              }}
            >
              <Close size={16} />
            </Button>
          </div>
        </ChatColumn>
      </section>
      {thanks && <CurveBenderThanksDialog onClose={() => setThanks(false)} />}
    </>
  );
}

function CurveBenderThanksDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} size="sm">
      <DialogHeader title="CurveBender" onClose={onClose} />
      <DialogBody>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Thank you for trying CurveBender! Join{" "}
          <a
            href={COMMUNITY_URL}
            {...externalLinkProps}
            className="font-medium text-accent underline underline-offset-2 hover:text-primary"
          >
            #curvebender-community
          </a>{" "}
          to learn more and share feedback.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your agent is now set to use CurveBender. Change provider anytime
          using the picker at the bottom of the page.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Modal>
  );
}
