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

// UNIT_BOUNDARY_DESCRIPTION: a field's character count against its limit, red once over. It is not a live region: a screen reader hears it with the field's description on focus, and the field's error announces going over, so typing is not interrupted on every key.
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
      className={cn(
        "text-xs tabular-nums",
        length > max ? "text-danger" : "text-muted-foreground",
      )}
    >
      {length} / {max}
    </span>
  );
}
