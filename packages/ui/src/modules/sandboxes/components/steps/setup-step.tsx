import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { ProviderPresetType, SecretView } from "../../../../types.js";
import { useSecrets } from "../../../secrets/api/queries.js";
import { useProviderActions } from "../../../settings/components/use-provider-actions.js";
import type {
  EgressPreset,
  WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { ProviderConnectDialog } from "../provider-connect-dialog.js";
import { ProviderRow } from "../provider-row.js";
import {
  type RegistryCredential,
  RegistryCredentialSection,
  registryFilledCount,
} from "../registry-credential-section.js";
import { StepHeader } from "../step-header.js";
import { WizardSectionLabel } from "../wizard-section-label.js";

const PROVIDER_ROWS: { type: ProviderPresetType; description: string }[] = [
  {
    type: "ibm-litellm",
    description: "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS.",
  },
  {
    type: "bob",
    description:
      "IBM Bob Shell endpoint with twin-secret credential injection.",
  },
  {
    type: "anthropic",
    description:
      "Claude Code, Claude SDK, and any Anthropic-compatible client.",
  },
  {
    type: "openai",
    description: "GPT-family models for Codex and OpenAI-compatible agents.",
  },
];

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
  const { data: secrets = [] } = useSecrets();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    secret?: SecretView;
  } | null>(null);

  const secretByType = useMemo(
    () => new Map(secrets.map((s) => [s.type, s])),
    [secrets],
  );

  const removeKey = (secretId: string) =>
    providerActions.remove(secretId, () => {
      if (providerSecretId === secretId) update({ providerSecretId: null });
    });

  // Auto-select the first connected provider; only acts while empty so a
  // just-connected one isn't nulled out during the secrets refetch.
  useEffect(() => {
    if (providerSecretId) return;
    const firstConnected = PROVIDER_ROWS.map((r) =>
      secretByType.get(r.type),
    ).find(Boolean);
    if (firstConnected) update({ providerSecretId: firstConnected.id });
  }, [providerSecretId, secretByType, update]);

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
        <Input
          value={name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="my-sandbox"
        />
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Provider</WizardSectionLabel>
        <div className="flex flex-col gap-3">
          {PROVIDER_ROWS.map((row) => {
            const secret = secretByType.get(row.type);
            return (
              <ProviderRow
                key={row.type}
                type={row.type}
                description={row.description}
                secret={secret}
                selected={!!secret && secret.id === providerSecretId}
                onConnect={() => setDialog({ provider: row.type })}
                onSelect={() =>
                  secret && update({ providerSecretId: secret.id })
                }
                onEditKey={() =>
                  secret && setDialog({ provider: row.type, secret })
                }
                onRemoveKey={() => secret && void removeKey(secret.id)}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Network access</WizardSectionLabel>
        <div className="flex flex-col gap-3">
          {NETWORK_PRESETS.map((preset) => (
            <NetworkPresetRow
              key={preset.value}
              label={preset.label}
              help={preset.help}
              selected={egressPreset === preset.value}
              onSelect={() => update({ egressPreset: preset.value })}
            />
          ))}
        </div>
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

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          secret={dialog.secret}
          onConnected={(secretId) => {
            update({ providerSecretId: secretId });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
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
        "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/50"
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
        <p className="text-[14px] font-medium text-foreground">{label}</p>
        <p className="text-[12px] text-muted-foreground">{help}</p>
      </div>
    </button>
  );
}
