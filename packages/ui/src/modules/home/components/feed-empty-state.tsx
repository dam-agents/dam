import { Checkmark, Filter } from "@carbon/icons-react";

interface Props {
  title: string;
  message: string;
  tone: "clear" | "filtered";
}

export function FeedEmptyState({ title, message, tone }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-10 text-center">
      <div className="mb-2 flex items-center justify-center gap-2">
        {tone === "clear" ? (
          <Checkmark size={16} className="text-success" />
        ) : (
          <Filter size={16} className="text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
