import { Checkmark, Copy } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/use-copy";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "../../../../components/modal.js";

interface Props {
  plaintext: string;
  onClose: () => void;
}

export function RevealToken({ plaintext, onClose }: Props) {
  const { copy, state: copyState } = useCopy();

  return (
    <>
      <DialogHeader title="Save this token now" />
      <DialogBody>
        <p className="text-[13px] text-muted-foreground mb-4">
          This is the only time the token will be shown. If you lose it, revoke
          this key and create a new one.
        </p>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border border-border font-mono text-[12px]">
          <code className="flex-1 break-all">{plaintext}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void copy(plaintext)}
            aria-label={
              copyState === "copied"
                ? "Copied to clipboard"
                : "Copy to clipboard"
            }
            className="shrink-0 text-muted-foreground"
          >
            {copyState === "copied" ? (
              <Checkmark size={16} aria-hidden />
            ) : (
              <Copy size={16} aria-hidden />
            )}
          </Button>
        </div>
        {copyState === "failed" && (
          <p className="text-[12px] text-danger mt-2">
            Couldn't copy automatically. Select the token above and copy it
            manually.
          </p>
        )}
        <p className="text-[12px] text-muted-foreground mt-3">
          Use as the bearer credential when calling the API. See the CLI
          documentation for the exact environment variable name.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
