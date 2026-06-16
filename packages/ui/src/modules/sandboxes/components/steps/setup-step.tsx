import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ProviderSection } from "../../../providers/components/provider-section.js";
import type {
  EgressPreset,
  WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CardList } from "../card-list.js";
import { FormField } from "../form-field.js";
import {
  type RegistryCredential,
  RegistryCredentialSection,
  registryFilledCount,
} from "../registry-credential-section.js";
import { StepHeader } from "../step-header.js";
import { WizardSectionLabel } from "../wizard-section-label.js";

const NETWORK_PRESETS: { value: EgressPreset; label: string; help: string }[] =
  [
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
  providerSecretId: string | null;
  egressPreset: EgressPreset;
  showRegistry: boolean;
  registryCredential: RegistryCredential;
  onRegistryChange: (value: RegistryCredential) => void;
  update: (patch: Partial<WizardSnapshot>) => void;
  onContinue: () => void;
}

export function SetupStep({
  name,
  providerSecretId,
  egressPreset,
  showRegistry,
  registryCredential,
  onRegistryChange,
  update,
  onContinue,
}: Props) {
  const registryPartial =
    showRegistry &&
    registryFilledCount(registryCredential) > 0 &&
    registryFilledCount(registryCredential) < 3;
  const canContinue =
    name.trim().length > 0 && providerSecretId !== null && !registryPartial;

  return (
    <div>
      <StepHeader
        step={2}
        title="Setup your sandbox"
        subtitle="Name your sandbox, choose a provider, and set network permissions."
      />

      <section className="mb-8">
        <WizardSectionLabel>Name</WizardSectionLabel>
        <FormField>
          <Input
            autoFocus
            value={name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="my-sandbox"
          />
        </FormField>
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Provider</WizardSectionLabel>
        <ProviderSection
          selectedSecretId={providerSecretId}
          onSelect={(secretId) => update({ providerSecretId: secretId })}
          onProviderRemoved={(secretId) => {
            if (providerSecretId === secretId)
              update({ providerSecretId: null });
          }}
          autoSelectFirst
          listClassName="md:-ml-4"
        />
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Network access</WizardSectionLabel>
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

      {showRegistry && (
        <RegistryCredentialSection
          value={registryCredential}
          onChange={onRegistryChange}
          partial={registryPartial}
        />
      )}

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}

function NetworkPresetRow({
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
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-card"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 rounded-full transition-all",
          selected ? "border-[5px] border-foreground" : "border border-border",
        )}
      />
      <div>
        <p className="text-[16px] font-medium text-foreground leading-[1.2]">
          {label}
        </p>
        <p className="text-[14px] text-muted-foreground">{help}</p>
      </div>
    </button>
  );
}
