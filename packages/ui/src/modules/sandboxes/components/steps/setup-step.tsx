import { FormField } from "@/components/form-field";
import { Callout } from "@/components/ui/callout";
import { CardButton } from "@/components/ui/card-button";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import type { ProviderRef } from "../../../providers/components/provider-item.js";
import { ProviderSelect } from "../../../providers/components/provider-select.js";
import type {
  EgressPreset,
  providerPolicy,
  WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CardList } from "../card-list.js";
import { SandboxSizeSection } from "../sandbox-size-section.js";
import { StepHeader } from "../step-header.js";

export const NETWORK_PRESETS: {
  value: EgressPreset;
  label: string;
  help: string;
}[] = [
  {
    value: "none",
    label: "Strict default-deny",
    help: "All outbound hosts require approval via inbox.",
  },
  {
    value: "trusted",
    label: "Trusted defaults (recommended)",
    help: "npm, PyPI, GitHub, package mirrors, Anthropic. Everything else hits inbox.",
  },
  {
    value: "all",
    label: "Allow everything",
    help: "Development escape hatch — no network restrictions.",
  },
];

interface Props {
  name: string;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
  update: (patch: Partial<WizardSnapshot>) => void;
  setupNote?: { title: string; body: string };
  templateSize?: { cpu?: string; memory?: string };
  sizeCpuMilli: number | null;
  sizeMemoryMi: number | null;
  /** Which providers this starting point offers, and which it steers toward. */
  providers: ReturnType<typeof providerPolicy>;
}

export function SetupStep({
  name,
  providerRef,
  egressPreset,
  update,
  setupNote,
  templateSize,
  sizeCpuMilli,
  sizeMemoryMi,
  providers,
}: Props) {
  return (
    <div>
      <StepHeader
        step={2}
        title="Setup your sandbox"
        subtitle="Name your sandbox, choose a provider, and set network permissions."
      />

      <section className="mb-8">
        <FormField label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="my-sandbox"
          />
        </FormField>
      </section>

      <SandboxSizeSection
        templateSize={templateSize}
        sizeCpuMilli={sizeCpuMilli}
        sizeMemoryMi={sizeMemoryMi}
        onChange={update}
      />

      {setupNote && (
        <section className="mb-8">
          <Callout tone="info" inset>
            <p className="text-[14px] font-semibold text-foreground">
              {setupNote.title}
            </p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {setupNote.body}
            </p>
          </Callout>
        </section>
      )}

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <Inset>
          <ProviderSelect
            selected={providerRef}
            onSelect={(ref) => update({ providerRef: ref })}
            autoSelectFirst
            allow={providers.allow}
            recommended={providers.recommended}
          />
        </Inset>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <CardList>
          {NETWORK_PRESETS.map((preset) => (
            <NetworkPresetRow
              key={preset.value}
              label={preset.label}
              help={preset.help}
              selected={egressPreset === preset.value}
              onSelect={() => update({ egressPreset: preset.value })}
            />
          ))}
        </CardList>
      </section>
    </div>
  );
}

export function NetworkPresetRow({
  label,
  help,
  selected,
  onSelect,
}: {
  label: string;
  help: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CardButton
      onClick={onSelect}
      selected={selected}
      className="w-full px-4 py-3"
    >
      <p className="text-[16px] font-medium text-foreground leading-[1.2]">
        {label}
      </p>
      <p className="text-[14px] text-muted-foreground">{help}</p>
    </CardButton>
  );
}
