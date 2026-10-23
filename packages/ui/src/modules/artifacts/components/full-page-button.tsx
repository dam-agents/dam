import { Maximize, Minimize } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

export function FullPageButton({
  fullPage,
  onToggle,
}: {
  fullPage: boolean;
  onToggle: () => void;
}) {
  const label = fullPage ? "Exit full page" : "Full page";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={fullPage}
      tooltip={label}
      onClick={onToggle}
    >
      {fullPage ? <Minimize size={16} /> : <Maximize size={16} />}
    </Button>
  );
}
