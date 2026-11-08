import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/errors";

import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";

const DESCRIPTION_HINT =
  "How this agent introduces itself to others: one or two sentences on what it is for.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the Agent is for, in its owner's words, on
 * its General page; read-only for a viewer who cannot change its settings.
 */
export function AgentDescriptionSection({ agent }: { agent: AgentView }) {
  const update = useUpdateAgent({ inlineError: true });
  const [draft, setDraft] = useState<string | null>(null);
  const saved = agent.description ?? "";
  const value = draft ?? saved;
  const changed = draft !== null && draft.trim() !== saved;
  const error = update.error
    ? getErrorMessage(update.error, "Couldn't save the description.")
    : undefined;

  if (!holds(agent.access, "settings"))
    return saved ? (
      <section className="mb-8">
        <FormField label="Description">
          <p className="text-sm whitespace-pre-line">{saved}</p>
        </FormField>
      </section>
    ) : null;

  const save = () => {
    if (draft === null || !changed || update.isPending) return;
    const sent = draft;
    update.mutate(
      { id: agent.id, description: sent.trim() },
      {
        onSuccess: () =>
          setDraft((current) => (current === sent ? null : current)),
      },
    );
  };

  return (
    <section className="mb-8">
      <FormField label="Description" hint={DESCRIPTION_HINT} error={error}>
        <Textarea
          rows={2}
          value={value}
          variant={error ? "invalid" : "standard"}
          placeholder="Takes meeting notes and files the action items."
          onChange={(e) => {
            setDraft(e.target.value);
            update.reset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
        />
      </FormField>
      {changed && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={update.isPending} onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => {
              setDraft(null);
              update.reset();
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model settings the harness carries itself,
 * which belong to the Agent rather than to one session; the Providers panel
 * shows them below the providers and the defaults.
 */
export function AgentModelSettingsSection({ agentId }: { agentId: string }) {
  const { data: harnessStatus } = useHarnessConfigStatus(agentId);
  const carriedHarnesses = harnessStatus?.harnesses ?? null;
  if (!carriedHarnesses) return <SandboxModelSettings agentId={agentId} />;
  if (carriedHarnesses.some((h) => h.sessionSettings)) return null;
  return (
    <HarnessSettingsSections agentId={agentId} harnesses={carriedHarnesses} />
  );
}
