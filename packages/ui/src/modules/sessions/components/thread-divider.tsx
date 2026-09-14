export function ThreadDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-border/60" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}
