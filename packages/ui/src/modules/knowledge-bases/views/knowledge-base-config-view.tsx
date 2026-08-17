import { Chat } from "@carbon/icons-react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { READ_ONLY_FIELD } from "@/components/ui/read-only-field";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { useSandboxSettingsForm } from "../../sandboxes/hooks/use-sandbox-settings-form.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";

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
          <p className="text-sm text-muted-foreground">
            Knowledge base not found.
          </p>
        ) : f.status === "no-agent" ? (
          <p className="text-sm text-muted-foreground">
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
          <Tooltip content="Open chat">
            <Button
              size="icon"
              aria-label="Open chat"
              variant="outline"
              onClick={() => openKnowledgeBase(agent.id)}
            >
              <Chat />
            </Button>
          </Tooltip>
        }
      />

      <section className="mb-8">
        {}
        <FormField label="Name" disableInset error={f.errors.name?.message}>
          <Input disabled={f.saving} {...f.register("name")} />
        </FormField>
      </section>

      <section className="mb-8">
        {}
        <SectionLabel spaced>Harness</SectionLabel>
        <div className={READ_ONLY_FIELD}>
          <span className={`truncate ${agent.templateId ? "" : "font-mono"}`}>
            {f.templateName ?? agent.image}
          </span>
        </div>
      </section>

      {}

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
          oauthReturnView={routeToPath({
            view: "knowledge-base-config",
            agentId: agent.id,
          })}
        />
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={f.onSave} disabled={f.isSubmitDisabled}>
          {f.saving ? "Saving…" : "Submit changes"}
        </Button>
        {f.wildcardHostInScope && (
          <span
            role="alert"
            className="inline-flex items-center gap-1.5 text-xs text-warning"
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
