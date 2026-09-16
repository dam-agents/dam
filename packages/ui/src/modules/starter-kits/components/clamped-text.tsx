import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Two lines of a kit's prose, the rest on hover.
 * A SKILL.md description is written for the model — a paragraph saying when to
 * reach for the skill — so a kit with a few of them would otherwise be a wall
 * of text wherever the catalog lists them.
 */
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
