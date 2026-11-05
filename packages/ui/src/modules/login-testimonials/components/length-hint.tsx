import { cn } from "@/lib/utils";

export function lengthError(
  label: string,
  value: string,
  max: number,
): string | undefined {
  const over = value.trim().length - max;
  return over > 0
    ? `${label} is ${over} ${over === 1 ? "character" : "characters"} over the ${max} limit.`
    : undefined;
}

export function LengthCount({
  value,
  max,
  id,
}: {
  value: string;
  max: number;
  id?: string;
}) {
  const length = value.trim().length;
  return (
    <span
      id={id}
      aria-live="polite"
      className={cn(
        "text-xs tabular-nums",
        length > max ? "text-danger" : "text-muted-foreground",
      )}
    >
      {length} / {max}
    </span>
  );
}
