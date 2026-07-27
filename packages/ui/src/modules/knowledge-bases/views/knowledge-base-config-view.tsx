import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { viewToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { READ_ONLY_FIELD } from "../../sandboxes/components/sandbox-setup-section.js";
import { useSandboxSettingsForm } from "../../sandboxes/hooks/use-sandbox-settings-form.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";

/** Lean settings/detail page for a knowledge base. A knowledge base is an
 *  agent, so it reuses the sandbox settings engine ([use-sandbox-settings-form])
 *  for the shared save/dirty machinery — but renders a flush, pared-down set of
 *  fields (no `md:-ml-4` outdent), matching the KB create form. Only the
 *  knobs that make sense for a KB are exposed: name, size, network, and
 *  connections; the harness image is shown read-only (create-only, #2946). */
export function KnowledgeBaseConfigView() {
  const f = useSandboxSettingsForm();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteAgent = useDeleteAgent();
  const display = useResolvedAgentDisplay(f.agent);

  if (f.status !== "ready" || !f.agent || !display) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-10 md:px-8">
        {f.status === "not-found" ? (
          <p className="text-[13px] text-muted-foreground">
            Knowledge base not found.
          </p>
        ) : f.status === "no-agent" ? (
          <p className="text-[13px] text-muted-foreground">
            No knowledge base selected.
          </p>
        ) : null}
      </div>
    );
  }

  const { agent } = f;

  const onDelete = async () => {
    if (!(await confirmDeleteKnowledgeBase(showConfirm, agent.name))) return;
    deleteAgent.mutate(
      { id: agent.id },
      { onSuccess: () => navigateToKnowledgeBases() },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-10 pb-16 md:px-8">
      <PageHeader
        title={agent.name}
        description="Configure this knowledge base. Feed it sources and ask questions in chat."
        adornment={<StatusBadge state={display.state} />}
        actions={
          <Button variant="outline" onClick={() => openKnowledgeBase(agent.id)}>
            Open chat
          </Button>
        }
      />

      <section className="mb-8">
        {/* disableInset: this page is flush (no gutter to outdent into). */}
        <FormField label="Name" disableInset error={f.errors.name?.message}>
          <Input disabled={f.saving} {...f.register("name")} />
        </FormField>
      </section>

      <section className="mb-8">
        {/* Harness image is create-only: changing it means delete + recreate,
            which would destroy the knowledge base's workspace. */}
        <SectionLabel spaced>Harness</SectionLabel>
        <div className={READ_ONLY_FIELD}>
          <span className={`truncate ${agent.templateId ? "" : "font-mono"}`}>
            {f.templateName ?? agent.image}
          </span>
        </div>
      </section>

      {/* CPU/Memory are intentionally not exposed: a knowledge base runs on the
          template/platform defaults, keeping the surface conversational rather
          than a resource-tuning panel. The settings form leaves size untouched,
          so it stays at the agent's current values. */}

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <div className="rounded-lg border border-border p-4">
          <AgentEgressEditor
            agentId={agent.id}
            currentPreset={f.currentPreset}
            staged={f.egressStaged}
          />
        </div>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Connections</SectionLabel>
        <ConnectionsSection
          agentId={agent.id}
          oauthReturnView={viewToPath("knowledge-base-config", null, agent.id)}
        />
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={f.onSave} disabled={f.isSubmitDisabled}>
          {f.saving ? "Saving…" : "Submit changes"}
        </Button>
        {f.wildcardHostInScope && (
          <span
            role="alert"
            className="inline-flex items-center gap-1.5 text-[12px] text-warning"
            title="A wildcard host '*' rule is in scope. Any unmatched egress is allowed."
          >
            <span aria-hidden="true">⚠</span>
            Allow everything is on — narrow with deny rules or remove the
            wildcard.
          </span>
        )}
      </div>

      <section className="mt-12 border-t border-border pt-6">
        <SectionLabel spaced>Danger zone</SectionLabel>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={deleteAgent.isPending}
          onClick={() => void onDelete()}
        >
          Delete knowledge base
        </Button>
      </section>
    </div>
  );
}
