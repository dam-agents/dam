import type { HarnessCapability } from "agent-runtime-api";
import { modelConstraintsFor, SUBAGENT_MODEL_SETTING } from "agent-runtime-api";
import { Fragment, useId } from "react";

import { Select } from "@/components/ui/select";

import {
  isModelOption,
  sessionSettingOptions,
} from "../lib/session-settings.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session's own settings — effort, thinking,
 * prompt cache — as one row each. Subagents are not here: one subagent profile
 * covers both kinds of subagent, in its own section of the model picker.
 */
export function SessionSettingsControls({
  capability,
  model,
  settings,
  defaults,
  modelChoices = [],
  disabled = false,
  onChange,
}: {
  agentId: string;
  carried: readonly HarnessCapability[];
  capability: HarnessCapability | undefined;
  model: string | null;
  settings: Readonly<Record<string, string>>;
  defaults: Readonly<Record<string, string>>;
  modelChoices?: readonly { value: string; name: string }[];
  disabled?: boolean;
  onChange: (changes: Record<string, string>) => void;
}) {
  const id = useId();
  const catalog = capability?.harnessConfigCatalog;
  const options = sessionSettingOptions(capability).filter(
    (o) =>
      !o.subagents &&
      o.id !== SUBAGENT_MODEL_SETTING &&
      o.category !== "mode" &&
      o.category !== "approvals" &&
      (!isModelOption(o) || modelChoices.length > 0),
  );
  if (options.length === 0) return null;
  const rows = options.map((o) => {
    const modelValued = isModelOption(o);
    const allowed = modelConstraintsFor(catalog, model)?.[o.id];
    const value = settings[o.id] ?? defaults[o.id] ?? o.choices[0]?.value;
    const choices = modelValued
      ? [{ value: "", name: "Same as session" }, ...modelChoices]
      : o.choices.filter(
          (c) => !allowed || allowed.includes(c.value) || c.value === value,
        );
    return { option: o, value, choices };
  });
  const grid =
    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs";
  return (
    <div
      role="group"
      aria-label="Session settings"
      className="flex flex-col gap-1"
    >
      <div className={grid}>
        {rows.map(({ option: o, value, choices }) => (
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
              onChange={(e) => onChange({ [o.id]: e.target.value })}
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
        ))}
      </div>
    </div>
  );
}
