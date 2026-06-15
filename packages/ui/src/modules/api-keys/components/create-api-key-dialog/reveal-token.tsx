import { Check, Copy } from "lucide-react";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "../../../../components/modal.js";

interface Props {
  plaintext: string;
  onClose: () => void;
}

type CopyState = "idle" | "copied" | "failed";

export function RevealToken({ plaintext, onClose }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // clipboard API rejects in non-secure contexts and when the
      // browser blocks programmatic copy. Surface the failure so the
      // user falls back to manual select.
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 3000);
    }
  }

  return (
    <>
      <DialogHeader>
        <h2 className="text-[18px] font-bold">Save this token now</h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-[13px] text-text-secondary mb-4">
          This is the only time the token will be shown. If you lose it, revoke
          this key and create a new one.
        </p>
        <div className="flex items-stretch gap-2 p-3 rounded-lg bg-surface-raised border border-border-light font-mono text-[12px]">
          <code className="flex-1 break-all">{plaintext}</code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={
              copyState === "copied"
                ? "Copied to clipboard"
                : "Copy to clipboard"
            }
            className="shrink-0 px-2 py-1 rounded hover:bg-surface text-text-secondary"
          >
            {copyState === "copied" ? (
              <Check size={16} aria-hidden />
            ) : (
              <Copy size={16} aria-hidden />
            )}
          </button>
        </div>
        {copyState === "failed" && (
          <p className="text-[12px] text-danger mt-2">
            Couldn't copy automatically. Select the token above and copy it
            manually.
          </p>
        )}
        <p className="text-[12px] text-text-muted mt-3">
          Use as the bearer credential when calling the API. See the CLI
          documentation for the exact environment variable name.
        </p>
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-[13px] font-semibold rounded-lg bg-accent text-white hover:bg-accent-hover"
        >
          Done
        </button>
      </DialogFooter>
    </>
  );
}
