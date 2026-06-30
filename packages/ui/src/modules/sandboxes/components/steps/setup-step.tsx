import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import {
  type ProviderRef,
  sameProviderRef,
} from "../../../providers/components/provider-item.js";
import { ProviderSection } from "../../../providers/components/provider-section.js";
import type {
  EgressPreset,
  WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CardList } from "../card-list.js";
import {
  type RegistryCredential,
  RegistryCredentialSection,
  registryFilledCount,
} from "../registry-credential-section.js";
import { StepHeader } from "../step-header.js";

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
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
  showRegistry: boolean;
  registryCredential: RegistryCredential;
  onRegistryChange: (value: RegistryCredential) => void;
  update: (patch: Partial<WizardSnapshot>) => void;
  setupNote?: { title: string; body: string };
}

export function SetupStep({
  name,
  providerRef,
  egressPreset,
  showRegistry,
  registryCredential,
  onRegistryChange,
  update,
  setupNote,
}: Props) {
  const registryPartial =
    showRegistry &&
    registryFilledCount(registryCredential) > 0 &&
    registryFilledCount(registryCredential) < 3;

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

      {setupNote && (
        <section className="mb-8">
          <div className="rounded-lg border border-callout-border bg-callout p-4 md:-ml-4">
            <p className="text-[14px] font-semibold text-foreground">
              {setupNote.title}
            </p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {setupNote.body}
            </p>
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <ProviderSection
          selected={providerRef}
          onSelect={(ref) => update({ providerRef: ref })}
          onProviderRemoved={(ref) => {
            if (providerRef && sameProviderRef(providerRef, ref))
              update({ providerRef: null });
          }}
          autoSelectFirst
          listClassName={FIELD_INSET}
        />
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

      {showRegistry && (
        <RegistryCredentialSection
          value={registryCredential}
          onChange={onRegistryChange}
          partial={registryPartial}
        />
      )}
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
        "w-full rounded-lg border px-4 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-card"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      <p className="text-[16px] font-medium text-foreground leading-[1.2]">
        {label}
      </p>
      <p className="text-[14px] text-muted-foreground">{help}</p>
    </button>
  );
}
