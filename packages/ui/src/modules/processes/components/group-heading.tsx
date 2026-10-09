export const GROUP_HEADING_CLASS =
  "flex w-full items-center gap-1.5 border-b border-border px-4 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function GroupCount({ count }: { count: number }) {
  return (
    <span className="font-normal tracking-normal text-muted-foreground/70 tabular-nums">
      {count}
    </span>
  );
}
