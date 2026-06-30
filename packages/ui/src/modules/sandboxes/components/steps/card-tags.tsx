export function CardTags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="shrink-0 text-[14px] text-muted-foreground">
      {tags.join(" · ")}
    </span>
  );
}
