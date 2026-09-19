import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ClampedText({
  text,
  lines = 2,
  className,
}: {
  text: string;
  lines?: 1 | 2;
  className?: string;
}) {
  return (
    <Tooltip content={text} side="top">
      <p
        className={cn(
          lines === 1 ? "line-clamp-1" : "line-clamp-2",
          "cursor-help",
          className,
        )}
      >
        {text}
      </p>
    </Tooltip>
  );
}
