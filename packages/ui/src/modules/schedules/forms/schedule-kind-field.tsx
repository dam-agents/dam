import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionLabel } from "@/components/ui/section-label";

export type ScheduleKind = "repeat" | "once";

export function ScheduleKindField({
  value,
  onChange,
}: {
  value: ScheduleKind;
  onChange: (kind: ScheduleKind) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Runs</SectionLabel>
      <RadioGroup
        aria-label="Runs"
        className="flex-row gap-6"
        value={value}
        onValueChange={(next) => onChange(next === "once" ? "once" : "repeat")}
      >
        <RadioGroupItem value="repeat" label="Repeat" />
        <RadioGroupItem value="once" label="Once" />
      </RadioGroup>
    </div>
  );
}
