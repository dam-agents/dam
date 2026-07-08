import { cn } from "@/lib/utils";

// Three dots with a staggered jump (see `.working-dots` in App.css). Color
// comes from `currentColor`, so callers set it with a `text-*` class.
export function WorkingDots({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "working-dots inline-flex items-center gap-[1px]",
        className,
      )}
      title={title}
      data-testid="working-dots"
    >
      <span className="w-[4px] h-[4px] rounded-full bg-current" />
      <span className="w-[4px] h-[4px] rounded-full bg-current" />
      <span className="w-[4px] h-[4px] rounded-full bg-current" />
    </span>
  );
}
