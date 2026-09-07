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
    <Button
      variant={variant}
      size="xs"
      onClick={() => void copy(url).then(toastCopyOutcome)}
    >
      {copied ? (
        <Checkmark size={14} className="text-success" />
      ) : (
        <Link size={14} />
      )}
      Copy link
    </Button>
  );
}
