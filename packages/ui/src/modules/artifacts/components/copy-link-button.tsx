import { Checkmark, Link } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

import { toastCopyOutcome } from "../lib/share-link.js";

export function CopyLinkButton({
  url,
  variant,
}: {
  url: string;
  variant: "ghost" | "outline";
}) {
  const { copy, copied } = useCopy();
  return (
    <>
      <Button
        variant={variant}
        size="xs"
        aria-label="Copy link"
        onClick={() => void copy(url).then(toastCopyOutcome)}
      >
        {copied ? (
          <Checkmark size={14} className="text-success" />
        ) : (
          <Link size={14} />
        )}
        <span className="hidden sm:inline">Copy link</span>
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}
