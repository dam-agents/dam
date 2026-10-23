import { Close } from "@carbon/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { getBrand } from "../../../brand.js";
import { externalLinkProps } from "../../../lib/external-link.js";
import {
  browserStorage,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import { ChatColumn } from "./chat-column.js";

const DISMISSED_KEY = "platform-curvebender-alert-dismissed";
const DOCS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/";

type Variant = "try" | "first-sentence";

export function CurveBenderAlert({
  visible,
  selected,
  onTry,
}: {
  visible: boolean;
  selected: boolean | null;
  onTry: () => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => safeGetItem(browserStorage, DISMISSED_KEY) !== null,
  );
  const variant = useRef<Variant | null>(null);
  if (variant.current === null && selected !== null)
    variant.current = selected ? "first-sentence" : "try";
  if (!visible || dismissed || variant.current === null) return null;
  return (
    <section
      data-testid="curve-bender-alert"
      aria-label="CurveBender"
      className="px-4 md:px-8"
    >
      <ChatColumn>
        <div className="mb-3 flex items-start gap-3 rounded-xl bg-white px-4 py-3 text-sm leading-6 text-[#161616] ring-1 ring-black/10">
          <img
            src="/icons/curve-bender-color.svg"
            alt=""
            className="mt-0.5 size-6 shrink-0"
          />
          <p className="min-w-0 flex-1">
            <a
              href={DOCS_URL}
              {...externalLinkProps}
              className="font-medium text-[#2D4ED0] underline underline-offset-2"
            >
              CurveBender
            </a>{" "}
            now provides {getBrand().name} users with open-source models running
            on IBM infrastructure.
            {variant.current === "try" && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onTry}
                  className="font-medium text-[#2D4ED0] underline underline-offset-2"
                >
                  Try DeepSeek 4.1 Flash
                </button>{" "}
                now!
              </>
            )}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 shrink-0 text-[#525252] hover:bg-black/5 hover:text-[#161616]"
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
  );
}
