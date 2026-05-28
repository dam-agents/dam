import type { SessionView } from "../../../types.js";

interface Props {
  session: SessionView;
  onResume?: (sessionId: string) => void;
}

export function ScheduleSessionRow({ session, onResume }: Props) {
  const displayName = session.title || session.sessionId.slice(0, 12);
  const createdAt = new Date(
    session.updatedAt ?? session.createdAt,
  ).toLocaleString();

  return (
    <div
      onClick={() => onResume?.(session.sessionId)}
      className="flex items-center gap-2 px-4 py-2.5 pl-9 cursor-pointer hover:bg-muted transition-colors border-b border-border last:border-b-0"
    >
      <span className="text-[12px] text-foreground font-medium truncate flex-1">
        {displayName}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        created at: {createdAt}
      </span>
    </div>
  );
}
