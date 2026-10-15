import type {
  HarnessCapability,
  HarnessConfigCurrent,
} from "agent-runtime-api";
import { modelConstraintsFor } from "agent-runtime-api";
import { Fragment, useId, useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  findModel,
  type ModelGroup,
  sameSideGroups,
} from "../lib/catalog-groups.js";

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the settings a newly picked model keeps. A value
 * the model's constraints exclude (Haiku takes no effort) and a subagent
 * model on the other side of the router/native split are dropped, since the
 * runtime refuses either; a value it cannot judge stays.
 */
export function settingsForModel(
  capability: HarnessCapability | undefined,
  groups: readonly ModelGroup[],
  model: string | null,
  settings: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed = modelConstraintsFor(capability?.harnessConfigCatalog, model);
  const side = sameSideGroups(groups, model);
  return Object.fromEntries(
    Object.entries(settings).filter(([id, value]) => {
      const option = capability?.harnessConfigCatalog?.options.find(
        (o) => o.id === id,
      );
      if (option && isModelOption(option)) {
        const hit = findModel(groups, value);
        return !hit || side.includes(hit.group);
      }
      const only = allowed?.[id];
      return !only || only.includes(value);
    }),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model-valued setting picks the model for the
 * session's subagents, so it sits in a section of its own; every other
 * setting is the session's.
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
  capability: HarnessCapability | undefined;
  model: string | null;
  settings: Readonly<Record<string, string>>;
  defaults: Readonly<Record<string, string>>;
  modelChoices?: readonly { value: string; name: string }[];
  disabled?: boolean;
  onChange: (id: string, value: string) => void;
}) {
  const id = useId();
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const options = sessionSettingOptions(capability).filter(
    (o) => !isModelOption(o) || modelChoices.length > 0,
  );
  if (options.length === 0) return null;
  const rows = options.map((o) => {
    const allowed = modelConstraintsFor(
      capability?.harnessConfigCatalog,
      model,
    )?.[o.id];
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
    return { option: o, modelValued, value, choices };
  });
  const row = (
    { option: o, value, choices }: (typeof rows)[number],
    label: string,
  ) => (
    <Fragment key={o.id}>
      <label htmlFor={`${id}-${o.id}`} className="text-muted-foreground">
        {label}
      </label>
      <Select
        id={`${id}-${o.id}`}
        size="xs"
        variant="ghost"
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(o.id, e.target.value)}
      >
        {value !== undefined && !choices.some((c) => c.value === value) && (
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
  const own = rows.filter((r) => !r.modelValued);
  const subagent = rows.filter((r) => r.modelValued);
  const grid =
    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs";
  return (
    <div
      role="group"
      aria-label="Session settings"
      className="flex flex-col gap-1"
    >
      {own.length > 0 && (
        <div className={grid}>{own.map((r) => row(r, r.option.name))}</div>
      )}
      {subagent.length > 0 && (
        <div
          role="group"
          aria-label="Subagents"
          className={cn(
            "flex flex-col gap-1 text-xs",
            own.length > 0 && "border-t border-border pt-1",
          )}
        >
          <DisclosureToggle
            open={subagentsOpen}
            onToggle={() => setSubagentsOpen((open) => !open)}
            chevronSize={12}
            className="text-muted-foreground hover:text-foreground"
          >
            <span>Subagents</span>
            {!subagentsOpen && (
              <span className="min-w-0 truncate text-foreground">
                {subagent
                  .map(
                    (r) =>
                      r.choices.find((c) => c.value === r.value)?.name ??
                      r.value,
                  )
                  .join(" · ")}
              </span>
            )}
          </DisclosureToggle>
          {subagentsOpen && (
            <div className={cn(grid, "pl-5")}>
              {subagent.map((r) => row(r, subagentLabel(r.option.name)))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const subagentLabel = (name: string) => {
  const rest = name.replace(/^subagents?\s+/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};
