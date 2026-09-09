import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  email: string;
  onRemove: (email: string) => void;
  disabled: boolean;
}

export function ViewerRow({ email, onRemove, disabled }: Props) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md py-1 pl-1 pr-0.5 hover:bg-muted/40">
      <span className="truncate text-sm text-foreground">{email}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${email}`}
        disabled={disabled}
        onClick={() => onRemove(email)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Close size={14} />
      </Button>
    </li>
  );
}
