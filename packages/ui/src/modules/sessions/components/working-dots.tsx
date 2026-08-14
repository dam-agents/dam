import { cn } from "@/lib/utils";

export function WorkingDots({
  className,
  title,
  size = "sm",
}: {
  className?: string;
  title?: string;
  size?: "sm" | "md";
}) {
  const dot = cn(
    "rounded-full bg-current",
    size === "md" ? "w-[5px] h-[5px]" : "w-1 h-1",
  );
  return (
    <span
      className={cn(
        "working-dots inline-flex items-center",
        size === "md" ? "gap-[2px]" : "gap-[1px]",
        className,
      )}
      title={title}
      data-testid="working-dots"
    >
      <span className={dot} />
      <span className={dot} />
      <span className={dot} />
    </span>
  );
}
