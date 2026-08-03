import { cn } from "@/lib/utils";

// Dependency-free switch: there's no Switch primitive in components/ui and
// @radix-ui/react-switch isn't a dependency, so this follows the same pattern
// as the other hand-rolled tokens here.
export function Switch({
  checked,
  onCheckedChange,
  testId,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  testId?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
