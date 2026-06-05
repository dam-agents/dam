import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
  useCreateSecret,
  useTestAnthropic,
} from "../../../secrets/api/mutations.js";
import { useSecrets } from "../../../secrets/api/queries.js";
import {
  findReusableSecret,
  getLlmProvider,
  type LlmProvider,
  providersForHarness,
} from "../../lib/llm-providers.js";
import type { WizardSnapshot } from "../../lib/wizard-snapshot.js";
import { LabeledInput } from "../labeled-input.js";
import { ProviderPicker } from "./provider-picker.js";

export function LlmStep({
  snapshot,
  update,
  onCancel,
  onNext,
}: {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  const { data: secrets = [] } = useSecrets();
  const createSecret = useCreateSecret();
  const testAnthropic = useTestAnthropic();
  const providers = providersForHarness(snapshot.harness);

  const [value, setValue] = useState("");
  const [manualOverride, setManualOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const provider = snapshot.llmProvider
    ? getLlmProvider(snapshot.llmProvider)
    : null;
  const reusable = provider ? findReusableSecret(provider, secrets) : undefined;
  const useReuse =
    Boolean(reusable) && !manualOverride && !snapshot.llmSecretId;

  const selectProvider = (next: LlmProvider) => {
    setValue("");
    setError(null);
    setManualOverride(false);
    update({ llmProvider: next.id, llmSecretId: null });
  };

  const advance = async () => {
    if (!provider || !snapshot.name.trim()) return;
    setError(null);

    if (snapshot.llmSecretId) return onNext();
    if (useReuse && reusable) {
      update({ llmSecretId: reusable.id });
      return onNext();
    }

    const sanitized = value.trim();
    if (!sanitized) return setError("Enter a credential.");

    setBusy(true);
    try {
      if (provider.verifyEnvName) {
        const result = await testAnthropic.mutateAsync({
          value: sanitized,
          envName: provider.verifyEnvName,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
      }
      const secret = await createSecret.mutateAsync({
        type: provider.secretType,
        name: provider.id,
        value: sanitized,
      });
      update({ llmSecretId: secret.id });
      onNext();
    } catch {
      setError("Could not save the credential.");
    } finally {
      setBusy(false);
    }
  };

  const continueDisabled =
    busy ||
    !snapshot.name.trim() ||
    !provider ||
    (!snapshot.llmSecretId && !useReuse && value.trim().length === 0);

  return (
    <div className="flex flex-col gap-6">
      <LabeledInput
        label="Sandbox name"
        placeholder="my-sandbox"
        autoFocus
        value={snapshot.name}
        onChange={(name) => update({ name })}
      />

      <div>
        <span className="text-[13px] font-semibold text-foreground/80 block mb-1.5">
          {snapshot.harness === "bob" ? "Credential" : "LLM provider"}
        </span>
        <ProviderPicker
          providers={providers}
          selected={snapshot.llmProvider}
          onSelect={selectProvider}
          renderSelected={(selectedProvider) => (
            <CredentialField
              provider={selectedProvider}
              value={value}
              onChange={setValue}
              ready={Boolean(snapshot.llmSecretId)}
              onChangeCredential={() => {
                update({ llmSecretId: null });
                setManualOverride(true);
              }}
              reuseName={useReuse ? reusable?.name : undefined}
              onUseDifferent={() => setManualOverride(true)}
            />
          )}
        />
      </div>

      {error && (
        <p className="text-[12px] font-medium text-destructive">{error}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={advance} disabled={continueDisabled}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          Continue
        </Button>
      </div>
    </div>
  );
}

function CredentialField({
  provider,
  value,
  onChange,
  ready,
  onChangeCredential,
  reuseName,
  onUseDifferent,
}: {
  provider: LlmProvider;
  value: string;
  onChange: (v: string) => void;
  ready: boolean;
  onChangeCredential: () => void;
  reuseName?: string;
  onUseDifferent: () => void;
}) {
  if (ready)
    return (
      <div className="flex items-center gap-2 text-[13px] text-success">
        <Check size={15} /> Credential ready.
        <button
          type="button"
          onClick={onChangeCredential}
          className="text-muted-foreground hover:text-foreground underline ml-1"
        >
          change
        </button>
      </div>
    );

  if (reuseName)
    return (
      <div className="text-[13px] text-foreground/80">
        Reusing existing credential{" "}
        <strong className="text-foreground">{reuseName}</strong>.
        <button
          type="button"
          onClick={onUseDifferent}
          className="text-muted-foreground hover:text-foreground underline ml-1"
        >
          use a different credential
        </button>
      </div>
    );

  return (
    <LabeledInput
      label={`${provider.label} credential`}
      type="password"
      placeholder={provider.placeholder}
      value={value}
      onChange={onChange}
      hint={
        provider.verifyEnvName
          ? "Verified with Anthropic before the sandbox is created."
          : undefined
      }
    />
  );
}
