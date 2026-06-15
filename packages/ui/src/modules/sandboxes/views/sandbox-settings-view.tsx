import { ArrowLeft } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FormError } from "../../../components/form-error.js";
import { useStore } from "../../../store.js";
import { isProviderPresetType, type SecretView } from "../../../types.js";
import {
  useSetAgentAccess,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import { useAgentAccess, useAgents } from "../../agents/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";
import { ProviderSection } from "../components/provider-section.js";
import { WizardSectionLabel } from "../components/wizard-section-label.js";

const EMPTY_SECRETS: SecretView[] = [];

// Matches the `Input` resting geometry (border, radius, height, padding) so a
// read-only field sits flush with the editable Name field above it; muted fill
// + text signal that it can't be edited.
const READ_ONLY_FIELD =
  "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground";

const settingsSchema = z.object({ name: z.string().trim().min(1, "Required") });
type SettingsValues = z.infer<typeof settingsSchema>;

/**
 * Full-page settings for an existing sandbox (`/sandboxes/:id`), reached
 * from the Sandboxes list. Slice 01 covers the header — editable Name,
 * read-only Image, and the reused Provider picker — plus the staged-form
 * container and a single Save. The connections / network / environment
 * sections land in slice 02.
 *
 * Provider is just a granted provider-type secret: the baseline is the
 * provider secret already on the agent, and selecting another stages a
 * swap that Save commits via `setAgentAccess` while preserving every
 * non-provider grant.
 */
export function SandboxSettingsView() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);

  const agentsQuery = useAgents();
  const agent = useMemo(
    () =>
      agentId
        ? (agentsQuery.data?.list.find((a) => a.id === agentId) ?? null)
        : null,
    [agentsQuery.data, agentId],
  );

  const secretsQuery = useSecrets();
  const secrets = secretsQuery.data ?? EMPTY_SECRETS;
  const { data: templates = [] } = useTemplates();
  const accessQuery = useAgentAccess(agentId);

  const updateAgent = useUpdateAgent();
  const setAgentAccess = useSetAgentAccess();

  const providerSecretIds = useMemo(
    () =>
      new Set(
        secrets.filter((s) => isProviderPresetType(s.type)).map((s) => s.id),
      ),
    [secrets],
  );

  const { register, handleSubmit, reset, formState } = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    mode: "onChange",
    defaultValues: { name: "" },
  });
  const { errors, isDirty, dirtyFields, isSubmitting } = formState;
  const saving = isSubmitting;

  // Provider selection is staged outside RHF (it maps to a secret grant, not
  // a form field). Baseline = the provider secret already granted to the
  // agent; selecting another stages a swap.
  const [ready, setReady] = useState(false);
  const [baselineProviderSecretId, setBaselineProviderSecretId] = useState<
    string | null
  >(null);
  const [selectedProviderSecretId, setSelectedProviderSecretId] = useState<
    string | null
  >(null);

  // Re-baseline when navigating to a different sandbox without unmounting.
  const baselinedRef = useRef(false);
  useEffect(() => {
    baselinedRef.current = false;
    setReady(false);
  }, [agentId]);

  // Adopt the agent's persisted values as the dirty-tracking baseline once
  // the agent, its access grants, and the secrets list have all resolved.
  useEffect(() => {
    if (baselinedRef.current) return;
    if (!agent || !accessQuery.data || secretsQuery.data === undefined) return;
    baselinedRef.current = true;
    const provId =
      accessQuery.data.secretIds.find((id) => providerSecretIds.has(id)) ??
      null;
    setBaselineProviderSecretId(provId);
    setSelectedProviderSecretId(provId);
    reset({ name: agent.name });
    setReady(true);
  }, [agent, accessQuery.data, secretsQuery.data, providerSecretIds, reset]);

  const providerChanged = selectedProviderSecretId !== baselineProviderSecretId;
  const dirty = isDirty || providerChanged;
  const isSubmitDisabled = saving || !ready || !dirty;

  const onSave = handleSubmit(async ({ name }) => {
    if (!agentId || !dirty) return;
    try {
      if (providerChanged) {
        // Swap the provider grant: drop any provider-type secret, add the
        // selected one, and preserve every non-provider grant untouched.
        const baselineSecretIds = accessQuery.data?.secretIds ?? [];
        const preserved = baselineSecretIds.filter(
          (id) => !providerSecretIds.has(id),
        );
        const secretIds = (
          selectedProviderSecretId
            ? [...new Set([...preserved, selectedProviderSecretId])]
            : preserved
        ).sort();
        await setAgentAccess.mutateAsync({ agentId, secretIds });
      }
      if (dirtyFields.name) {
        await updateAgent.mutateAsync({ id: agentId, name: name.trim() });
      }
      setBaselineProviderSecretId(selectedProviderSecretId);
      reset({ name: name.trim() });
    } catch {
      // Mutation meta.errorToast surfaces the failure; stay on the page.
    }
  });

  const goBack = () => {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and leave this sandbox?")
    )
      return;
    setView("list");
  };

  if (!agentId || (agentsQuery.data !== undefined && !agent)) {
    return (
      <div className="mx-auto w-full max-w-[666px]">
        <BackLink onClick={goBack} />
        <p className="mt-4 text-[13px] text-muted-foreground">
          {agentId ? "Sandbox not found." : "No sandbox selected."}
        </p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto w-full max-w-[666px]">
        <BackLink onClick={goBack} />
      </div>
    );
  }

  const templateName = agent.templateId
    ? (templates.find((t) => t.id === agent.templateId)?.name ??
      agent.templateId)
    : null;

  return (
    <div className="mx-auto w-full max-w-[666px]">
      <BackLink onClick={goBack} />
      <h1 className="mb-8 mt-2 text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
        {agent.name}
      </h1>

      <section className="mb-8">
        <WizardSectionLabel>Name</WizardSectionLabel>
        <Input disabled={saving} {...register("name")} />
        <FormError message={errors.name?.message} />
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Image</WizardSectionLabel>
        {/* Read-only: image/template are create-only — changing them would
            mean delete+recreate, destroying the workspace PVC. Styled as a
            disabled input so it reads as a non-editable field alongside Name. */}
        <div className={READ_ONLY_FIELD}>
          <span className={`truncate ${agent.templateId ? "" : "font-mono"}`}>
            {templateName ?? agent.image}
          </span>
        </div>
        {agent.templateId && (
          <p className="mt-1.5 truncate font-mono text-[12px] text-muted-foreground">
            {agent.image}
          </p>
        )}
      </section>

      <section className="mb-8">
        <WizardSectionLabel>Provider</WizardSectionLabel>
        <ProviderSection
          selectedSecretId={selectedProviderSecretId}
          onSelect={setSelectedProviderSecretId}
          onProviderRemoved={(secretId) => {
            if (selectedProviderSecretId === secretId)
              setSelectedProviderSecretId(null);
          }}
        />
        <p className="mt-3 text-[12px] text-muted-foreground">
          Changing the provider swaps this sandbox's model credential. A
          cross-family switch (e.g. Anthropic → OpenAI on a Claude image) can
          break the agent and may need a restart.
        </p>
      </section>

      <div className="flex justify-end pb-4">
        <Button onClick={onSave} disabled={isSubmitDisabled}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-ml-2 h-auto self-start px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={12} /> Back to Sandboxes
    </Button>
  );
}
