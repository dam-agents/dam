import { Wikis } from "@carbon/icons-react";

interface Props {
  url: string;
  onOpen: () => void;
}

export function MockBrowserLinkChip({ url, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Wikis size={12} className="shrink-0" />
      <span className="truncate max-w-[200px]">{url}</span>
    </button>
  );
}
