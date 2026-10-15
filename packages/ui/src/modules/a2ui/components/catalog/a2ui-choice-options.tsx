import type { ChoicePickerComponent } from "api-server-api/chat-forms";

import { cardSelectionVariants } from "@/components/ui/card";
import { CheckboxItem } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { splitRecommended } from "../../lib/recommended.js";
import { A2uiRecommendedMark } from "./a2ui-recommended-mark.js";

interface Option {
  value: string;
  label: string;
}

const MAX_RADIO_OPTIONS = 4;

interface ToggleProps {
  option: Option;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

function OptionLabel({ label }: { label: string }) {
  const { text, recommended } = splitRecommended(label);
  return (
    <>
      {text}
      {recommended && <A2uiRecommendedMark />}
    </>
  );
}

function toggled(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

function SegmentOption({ option, selected, onChange }: ToggleProps) {
  const { editable } = useA2uiSurface();
  const active = selected.includes(option.value);
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={!editable}
      onClick={() => onChange([option.value])}
      className={cn(
        "rounded-md px-2.5 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "bg-card font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <OptionLabel label={option.label} />
    </button>
  );
}

function ChipOption({ option, selected, onChange }: ToggleProps) {
  const { editable } = useA2uiSurface();
  const active = selected.includes(option.value);
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={!editable}
      onClick={() => onChange(toggled(selected, option.value))}
      className={cn(
        cardSelectionVariants({ selected: active }),
        "rounded-md px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50",
        active && "font-medium",
      )}
    >
      <OptionLabel label={option.label} />
    </button>
  );
}

function CheckboxOption({ option, selected, onChange }: ToggleProps) {
  const { editable } = useA2uiSurface();
  const { text, recommended } = splitRecommended(option.label);
  return (
    <CheckboxItem
      label={text}
      labelSuffix={recommended && <A2uiRecommendedMark />}
      aria-label={option.label}
      checked={selected.includes(option.value)}
      disabled={!editable}
      onCheckedChange={() => onChange(toggled(selected, option.value))}
    />
  );
}

interface Props {
  component: ChoicePickerComponent;
  options: readonly Option[];
  allOptions: readonly Option[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

export function A2uiChoiceOptions({
  component,
  options,
  allOptions,
  selected,
  onChange,
}: Props) {
  const { editable } = useA2uiSurface();
  const exclusive = component.variant !== "multipleSelection";
  const chips = component.displayStyle === "chips";
  if (chips && exclusive)
    return (
      <div className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5">
        {options.map((option) => (
          <SegmentOption
            key={option.value}
            option={option}
            selected={selected}
            onChange={onChange}
          />
        ))}
      </div>
    );
  if (chips)
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <ChipOption
            key={option.value}
            option={option}
            selected={selected}
            onChange={onChange}
          />
        ))}
      </div>
    );
  if (!exclusive)
    return options.map((option) => (
      <CheckboxOption
        key={option.value}
        option={option}
        selected={selected}
        onChange={onChange}
      />
    ));
  if (allOptions.length > MAX_RADIO_OPTIONS)
    return (
      <Select
        value={selected[0] ?? ""}
        disabled={!editable}
        onChange={(event) => onChange([event.target.value])}
      >
        {selected.length === 0 && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {allOptions
          .filter(
            (option) =>
              selected.includes(option.value) ||
              options.some((shown) => shown.value === option.value),
          )
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </Select>
    );
  return (
    <RadioGroup
      value={selected[0] ?? ""}
      disabled={!editable}
      onValueChange={(next) => onChange([next])}
    >
      {options.map((option) => {
        const { text, recommended } = splitRecommended(option.label);
        return (
          <RadioGroupItem
            key={option.value}
            value={option.value}
            label={text}
            labelSuffix={recommended && <A2uiRecommendedMark />}
            aria-label={option.label}
          />
        );
      })}
    </RadioGroup>
  );
}
