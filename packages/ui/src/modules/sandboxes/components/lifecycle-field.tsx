import { FormField } from "@/components/form-field";
import { Select } from "@/components/ui/select";

export const DEFAULT_HIBERNATE_MIN = 60;

const SLEEP_OPTIONS = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 0, label: "Never" },
];

export function SleepAfterIdleField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const options = SLEEP_OPTIONS.some((o) => o.minutes === value)
    ? SLEEP_OPTIONS
    : [...SLEEP_OPTIONS, { minutes: value, label: `${value} minutes` }];
  return (
    <FormField label="Sleep after being idle for:">
      <Select
        aria-label="Sleep after being idle for"
        data-testid="sleep-after-idle"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.minutes} value={o.minutes}>
            {o.label}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
