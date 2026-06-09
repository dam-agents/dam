import type { EgressPreset } from "api-server-api";

interface PresetOption {
  value: EgressPreset;
  title: string;
  description: string;
}

// Ordered most-restricted → least-restricted. The middle option (trusted) is
// the default (see EMPTY_SNAPSHOT.egressPreset).
const PRESETS: readonly PresetOption[] = [
  {
    value: "none",
    title: "Strict default-deny",
    description: "Every host hits the inbox until you approve",
  },
  {
    value: "trusted",
    title: "Trusted defaults (recommended)",
    description: "npm, PyPI, GitHub, package mirrors, Anthropic",
  },
  {
    value: "all",
    title: "Allow everything",
    description: "Development escape hatch — no inbox prompts",
  },
];

export function NetworkAccessSection({
  value,
  onChange,
}: {
  value: EgressPreset;
  onChange: (preset: EgressPreset) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
        Network access
      </span>
      <p className="text-[12px] text-muted-foreground">
        Initial set of hosts the sandbox can reach. Anything not covered
        surfaces in the inbox; you can change this later from the agent's
        Network access tab.
      </p>
      <div className="flex flex-col gap-1.5">
        {PRESETS.map((preset) => (
          <PresetRadio
            key={preset.value}
            preset={preset}
            checked={value === preset.value}
            onSelect={() => onChange(preset.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PresetRadio({
  preset,
  checked,
  onSelect,
}: {
  preset: PresetOption;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5">
      <input
        type="radio"
        name="egress-preset"
        value={preset.value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 w-4 h-4 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-foreground">
          {preset.title}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {preset.description}
        </span>
      </span>
    </label>
  );
}
