import type { HarnessCapability } from "agent-runtime-api";
import {
  modelConstraintsFor,
  platformSubagentChoice,
  SUBAGENT_MODEL_SETTING,
} from "agent-runtime-api";
import { Fragment, useId, useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useHarnessCatalog } from "../api/session-pair.js";
import { harnessDisplayName } from "../lib/session-pair-options.js";
import {
  isModelOption,
  sessionSettingOptions,
} from "../lib/session-settings.js";
import { PlatformSubagentSettings } from "./platform-subagent-settings.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session's own settings, then a Subagents
 * section in two parts: the settings for the harness's own subagents, which
 * run in this sandbox, and what the session's platform sub-agents run on.
 * A change hands over every setting it touches; an empty value is unset.
 */
export function SessionSettingsControls({
  agentId,
  carried,
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
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const { data: harnessCatalog } = useHarnessCatalog();
  const catalog = capability?.harnessConfigCatalog;
  const options = sessionSettingOptions(capability).filter(
    (o) => !isModelOption(o) || modelChoices.length > 0,
  );
  const platform =
    capability?.platformSubagentSettings === true && carried.length > 0;
  if (options.length === 0 && !platform) return null;
  const subagentModel =
    settings[SUBAGENT_MODEL_SETTING] ??
    defaults[SUBAGENT_MODEL_SETTING] ??
    null;
  const rows = options.map((o) => {
    const modelValued = isModelOption(o);
    const forSubagents = modelValued || o.subagents === true;
    const allowed = modelConstraintsFor(
      catalog,
      forSubagents ? subagentModel : model,
    )?.[o.id];
    const value =
      settings[o.id] ??
      defaults[o.id] ??
      (modelValued || forSubagents ? "" : o.choices[0]?.value);
    const choices = modelValued
      ? [{ value: "", name: "Same as session" }, ...modelChoices]
      : [
          ...(forSubagents ? [{ value: "", name: "Same as session" }] : []),
          ...o.choices.filter(
            (c) => !allowed || allowed.includes(c.value) || c.value === value,
          ),
        ];
    return { option: o, modelValued, forSubagents, value, choices };
  });
  const change = (optionId: string, value: string): Record<string, string> => {
    if (optionId !== SUBAGENT_MODEL_SETTING) return { [optionId]: value };
    const allowed = modelConstraintsFor(catalog, value || null);
    const dropped = rows.filter(
      (r) =>
        r.forSubagents &&
        !r.modelValued &&
        r.value &&
        allowed?.[r.option.id] &&
        !allowed[r.option.id]!.includes(r.value),
    );
    return {
      ...Object.fromEntries(dropped.map((r) => [r.option.id, ""])),
      [optionId]: value,
    };
  };
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
        onChange={(e) => onChange(change(o.id, e.target.value))}
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
  const own = rows.filter((r) => !r.forSubagents);
  const subagent = rows.filter((r) => r.forSubagents);
  const platformHarness = platformSubagentChoice(settings)?.harness;
  const summary = [
    ...subagent
      .filter((r) => r.value)
      .map((r) => r.choices.find((c) => c.value === r.value)?.name ?? r.value),
    ...(platformHarness
      ? [
          `Platform: ${harnessDisplayName(platformHarness, harnessCatalog?.harnesses) ?? platformHarness}`,
        ]
      : []),
  ];
  const grid =
    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs";
  const heading =
    "col-span-2 pt-1 text-[11px] font-medium text-muted-foreground";
  const subgrid = "col-span-2 grid grid-cols-subgrid items-center gap-y-1";
  return (
    <div
      role="group"
      aria-label="Session settings"
      className="flex flex-col gap-1"
    >
      {own.length > 0 && (
        <div className={grid}>{own.map((r) => row(r, r.option.name))}</div>
      )}
      {(subagent.length > 0 || platform) && (
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
            {!subagentsOpen && summary.length > 0 && (
              <span className="min-w-0 truncate text-foreground">
                {summary.join(" · ")}
              </span>
            )}
          </DisclosureToggle>
          {subagentsOpen && (
            <div className={cn(grid, "pl-5")}>
              {subagent.length > 0 && (
                <div
                  role="group"
                  aria-labelledby={`${id}-sandbox-heading`}
                  className={subgrid}
                >
                  <span id={`${id}-sandbox-heading`} className={heading}>
                    In this sandbox
                  </span>
                  {subagent.map((r) => row(r, subagentLabel(r.option.name)))}
                </div>
              )}
              {platform && (
                <div
                  role="group"
                  aria-labelledby={`${id}-platform-heading`}
                  className={subgrid}
                >
                  <span id={`${id}-platform-heading`} className={heading}>
                    Platform sub-agents
                  </span>
                  <PlatformSubagentSettings
                    agentId={agentId}
                    carried={carried}
                    settings={settings}
                    idPrefix={id}
                    disabled={disabled}
                    onChange={onChange}
                  />
                </div>
              )}
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
