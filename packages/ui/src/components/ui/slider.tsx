import { cn } from "@/lib/utils";

// Dependency-free slider: no Slider primitive existed in components/ui and
// @radix-ui/react-slider isn't a dependency, so this styles the native range
// input, following the same pattern as the hand-rolled Switch.
export function Slider({
  value,
  min,
  max,
  step,
  onValueChange,
  label,
  valueText,
  disabled,
  testId,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (v: number) => void;
  label?: string;
  /** Human-readable value for assistive tech (`aria-valuetext`) — pass when
   *  the raw number is an internal unit (millicores, Mi) a screen reader
   *  shouldn't announce verbatim. */
  valueText?: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-valuetext={valueText}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
