import type { SessionConfigOption } from "@agentclientprotocol/sdk/dist/acp.js";
import { Check } from "lucide-react";

import { useStore } from "../../../store.js";
import {
  useAgentSettings,
  useSetAgentSettings,
} from "../../agents/api/agent-settings.js";
import { Section } from "./config-section.js";
import { flattenSelectOptions } from "./session-config-popover.js";

type SelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;

interface Choice {
  id: string;
  name: string;
  description?: string | null;
}

/**
 * The agent's persistent model/mode/config default, set from the Config panel
 * and written through to the harness's own config file. The per-session picker
 * in the composer (SessionConfigBar) overrides this default for one
 * conversation; this section sets what every new/scheduled session starts from.
 *
 * Shape mirrors ACP session config: `model` and `mode` are dedicated axes, and
 * everything else (e.g. the `thought_level` option) is a generic config option.
 * Options come from the ACP session-config slice; saved values come from the
 * server. Hidden when the harness can't honor a persistent default.
 */
export function ModelSettingsPanel({ agentId }: { agentId: string | null }) {
  const models = useStore((s) => s.sessionModels);
  const modes = useStore((s) => s.sessionModes);
  const configOptions = useStore((s) => s.sessionConfigOptions);
  const { data } = useAgentSettings(agentId);
  const setSettings = useSetAgentSettings();

  if (!agentId || !data || !data.supported) return null;

  // Model arrives either as the legacy session-model axis or as a
  // `category: "model"` select option — normalize both (same as the popover).
  const modelOption = configOptions.find(
    (o): o is SelectConfigOption =>
      o.category === "model" && o.type === "select",
  );
  const modelChoices: Choice[] = models
    ? models.availableModels.map((m) => ({
        id: m.modelId,
        name: m.name,
        description: m.description,
      }))
    : modelOption
      ? flattenSelectOptions(modelOption.options).map((o) => ({
          id: o.value,
          name: o.name,
          description: o.description,
        }))
      : [];
  const modeChoices: Choice[] =
    modes?.availableModes.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    })) ?? [];
  // Every other select option (e.g. `thought_level`) — model/mode have their
  // own groups above, so exclude those categories to avoid rendering twice.
  // Boolean options are persistable (the contribution/driver accept booleans)
  // but not yet surfaced here as a saved default; they remain a live per-session
  // toggle in the composer popover. Deferred until a harness ships one.
  const extraOptions = configOptions.filter(
    (o): o is SelectConfigOption =>
      o.type === "select" && o.category !== "model" && o.category !== "mode",
  );

  if (
    modelChoices.length === 0 &&
    modeChoices.length === 0 &&
    extraOptions.length === 0
  ) {
    return (
      <Section title="Model">
        <div className="px-4 py-3 text-[12px] text-text-muted">
          Start a session to load the options this agent offers.
        </div>
      </Section>
    );
  }

  const persist = (patch: {
    model?: string | null;
    mode?: string | null;
    configOptions?: Record<string, string | boolean>;
  }) =>
    setSettings.mutate({
      agentId,
      model: data.model,
      mode: data.mode,
      configOptions: data.configOptions,
      ...patch,
    });

  return (
    <Section title="Model">
      {modelChoices.length > 0 && (
        <OptionGroup
          title="Model"
          choices={modelChoices}
          value={data.model}
          onSelect={(id) => persist({ model: id })}
        />
      )}
      {modeChoices.length > 0 && (
        <OptionGroup
          title="Mode"
          choices={modeChoices}
          value={data.mode}
          onSelect={(id) => persist({ mode: id })}
        />
      )}
      {extraOptions.map((option) => (
        <ConfigOptionGroup
          key={option.id}
          option={option}
          configOptions={data.configOptions}
          onChange={(next) => persist({ configOptions: next })}
        />
      ))}
    </Section>
  );
}

function ConfigOptionGroup({
  option,
  configOptions,
  onChange,
}: {
  option: SelectConfigOption;
  configOptions: Record<string, string | boolean>;
  onChange: (next: Record<string, string | boolean>) => void;
}) {
  const choices: Choice[] = flattenSelectOptions(option.options).map((o) => ({
    id: o.value,
    name: o.name,
    description: o.description,
  }));
  const saved = configOptions[option.id];
  const current = typeof saved === "string" ? saved : null;

  const select = (id: string | null) => {
    const next = { ...configOptions };
    if (id === null) delete next[option.id];
    else next[option.id] = id;
    onChange(next);
  };

  return (
    <OptionGroup
      title={option.name}
      choices={choices}
      value={current}
      onSelect={select}
    />
  );
}

function OptionGroup({
  title,
  choices,
  value,
  onSelect,
}: {
  title: string;
  choices: Choice[];
  value: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="border-b border-border-light last:border-b-0">
      <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
        {title}
      </div>
      <OptionRow
        label="Not set"
        description="No saved default — the harness picks on its own"
        active={value === null}
        onClick={() => onSelect(null)}
      />
      {choices.map((c) => (
        <OptionRow
          key={c.id}
          label={c.name}
          detail={c.id}
          description={c.description}
          active={c.id === value}
          onClick={() => onSelect(c.id)}
        />
      ))}
    </div>
  );
}

function OptionRow({
  label,
  detail,
  description,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  description?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-2 w-full px-4 py-2 text-[13px] text-left transition-colors ${active ? "text-accent bg-accent-light font-semibold" : "text-text hover:bg-surface-raised"}`}
      onClick={onClick}
    >
      {active && <Check size={12} className="shrink-0" />}
      <div className={active ? "" : "ml-[20px]"}>
        <div>{label}</div>
        {detail && (
          <div className="text-[11px] text-text-muted font-normal font-mono">
            {detail}
          </div>
        )}
        {description && (
          <div className="text-[11px] text-text-muted font-normal">
            {description}
          </div>
        )}
      </div>
    </button>
  );
}
