import { Close } from "@carbon/icons-react";

interface Props {
  email: string;
  onRemove: (email: string) => void;
  disabled: boolean;
}

export function ViewerChip({ email, onRemove, disabled }: Props) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs text-foreground">
      <span className="truncate">{email}</span>
      <button
        type="button"
        aria-label={`Remove ${email}`}
        disabled={disabled}
        onClick={() => onRemove(email)}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        <Close size={12} />
      </button>
    </span>
  );
}
