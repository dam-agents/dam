import type {
  HarnessCapability,
  HarnessConfigCurrent,
} from "agent-runtime-api";
import { Fragment, useId } from "react";

import { Select } from "@/components/ui/select";

export function sessionSettingOptions(
  capability: HarnessCapability | undefined,
) {
  return (
    capability?.harnessConfigCatalog?.options.filter(
      (o) => o.id !== "model" && capability.sessionSettings?.includes(o.id),
    ) ?? []
  );
}

export function settingDefaults(
  capability: HarnessCapability | undefined,
  configured: HarnessConfigCurrent | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    sessionSettingOptions(capability).flatMap((o) => {
      const value =
        (o.id === "mode"
          ? configured?.mode
          : configured?.configOptions[o.id]) ?? o.default;
      return value &&
        (o.choices.some((c) => c.value === value) || isModelOption(o))
        ? [[o.id, value]]
        : [];
    }),
  );
}

const isModelOption = (o: { category: string; choices: readonly unknown[] }) =>
  o.category === "model" && o.choices.length === 0;

export function SessionSettingsControls({
  capability,
  model,
  settings,
  defaults,
  modelChoices = [],
  disabled = false,
  onChange,
}: {
  capability: HarnessCapability | undefined;
  model: string | null;
  settings: Readonly<Record<string, string>>;
  defaults: Readonly<Record<string, string>>;
  modelChoices?: readonly { value: string; name: string }[];
  disabled?: boolean;
  onChange: (id: string, value: string) => void;
}) {
  const id = useId();
  const options = sessionSettingOptions(capability).filter(
    (o) => !isModelOption(o) || modelChoices.length > 0,
  );
  if (options.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Session settings"
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs"
    >
      {options.map((o) => {
        const allowed = model
          ? capability?.harnessConfigCatalog?.modelConstraints?.[model]?.[o.id]
          : undefined;
        const modelValued = isModelOption(o);
        const value =
          settings[o.id] ??
          defaults[o.id] ??
          (modelValued ? "" : o.choices[0]?.value);
        const choices = modelValued
          ? [{ value: "", name: "Same as session" }, ...modelChoices]
          : o.choices.filter(
              (c) => !allowed || allowed.includes(c.value) || c.value === value,
            );
        return (
          <Fragment key={o.id}>
            <label htmlFor={`${id}-${o.id}`} className="text-muted-foreground">
              {o.name}
            </label>
            <Select
              id={`${id}-${o.id}`}
              size="xs"
              variant="ghost"
              disabled={disabled}
              value={value ?? ""}
              onChange={(e) => onChange(o.id, e.target.value)}
            >
              {value !== undefined &&
                !choices.some((c) => c.value === value) && (
                  <option value={value}>{value}</option>
                )}
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Fragment>
        );
      })}
    </div>
  );
}
