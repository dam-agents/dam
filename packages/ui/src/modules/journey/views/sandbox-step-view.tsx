import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { LabeledInput } from "../../v2/components/labeled-input.js";
import { useSandboxWizard } from "../../v2/hooks/use-sandbox-wizard.js";
import { NetworkAccessSection } from "../components/network-access-section.js";
import { ProviderSection } from "../components/provider-section.js";
import { WizardLayout } from "../components/wizard-layout.js";

export function SandboxStepView() {
  const { snapshot, update } = useSandboxWizard();
  const setView = useStore((s) => s.setView);

  const ready = snapshot.name.trim().length > 0 && !!snapshot.llmSecretId;

  return (
    <WizardLayout
      current="new-sandbox"
      title="Configure your sandbox"
      subtitle="Name your sandbox, choose a provider, and set network permissions."
      onStepClick={setView}
      footer={
        <Button onClick={() => setView("new-connections")} disabled={!ready}>
          Continue <ArrowRight size={15} />
        </Button>
      }
    >
      <Field label="Name">
        <LabeledInput
          label=""
          placeholder="my-sandbox"
          autoFocus
          value={snapshot.name}
          onChange={(name) => update({ name })}
        />
      </Field>

      <ProviderSection
        selectedProvider={snapshot.llmProvider}
        selectedSecretId={snapshot.llmSecretId}
        onSelect={(llmProvider, secretId) =>
          update({ llmProvider, llmSecretId: secretId })
        }
        onDisconnect={() => update({ llmProvider: null, llmSecretId: null })}
      />

      <NetworkAccessSection
        value={snapshot.egressPreset}
        onChange={(egressPreset) => update({ egressPreset })}
      />
    </WizardLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
