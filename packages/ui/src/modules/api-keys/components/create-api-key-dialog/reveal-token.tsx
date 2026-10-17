import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { CopyState } from "@/hooks/use-copy";
import { externalLinkProps } from "@/lib/external-link";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "../../../../components/modal.js";
import { CLI_REFERENCE_URL } from "../../../../constants.js";

interface Props {
  plaintext: string;
  onClose: () => void;
}

export function RevealToken({ plaintext, onClose }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  return (
    <>
      <DialogHeader title="Save this token now" />
      <DialogBody>
        <p className="text-sm text-muted-foreground mb-4">
          This is the only time the token will be shown. If you lose it, revoke
          this key and create a new one.
        </p>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border border-border font-mono text-xs">
          <code className="flex-1 break-all">{plaintext}</code>
          <CopyButton
            value={plaintext}
            label="Copy token"
            size="icon-sm"
            onResult={setCopyState}
          />
        </div>
        {copyState === "failed" && (
          <p className="text-xs text-danger mt-2">
            Couldn't copy automatically. Select the token above and copy it
            manually.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          The{" "}
          <a
            href={CLI_REFERENCE_URL}
            {...externalLinkProps}
            className="text-primary underline-offset-2 hover:underline"
          >
            CLI reference
          </a>{" "}
          shows how to sign in with it. Scripts can also send it as a bearer
          token to the API.
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
