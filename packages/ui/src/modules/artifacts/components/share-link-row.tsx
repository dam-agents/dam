import { Checkmark, Copy } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/hooks/use-copy";

import { toastCopyOutcome } from "../lib/share-link.js";

export function ShareLinkRow({ shareUrl }: { shareUrl: string }) {
  const { copy, copied } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={shareUrl}
        size="sm"
        variant="monospace"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy link"
        tooltip="Copy link"
        onClick={() => void copy(shareUrl).then(toastCopyOutcome)}
      >
        {copied ? (
          <Checkmark size={14} className="text-success" />
        ) : (
          <Copy size={14} />
        )}
      </Button>
    </div>
  );
}
