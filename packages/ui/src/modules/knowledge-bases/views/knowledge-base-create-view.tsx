import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { sameProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSection } from "../../providers/components/provider-section.js";
import { GrantedConnectionsPanel } from "../../sandboxes/components/granted-connections-panel.js";
import { SandboxSizeSection } from "../../sandboxes/components/sandbox-size-section.js";
import {
  NETWORK_PRESETS,
  NetworkPresetRow,
} from "../../sandboxes/components/steps/setup-step.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { sizeToQuantities } from "../../sandboxes/lib/quantity.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateKnowledgeBase } from "../api/mutations.js";
import { useKnowledgeBaseDraft } from "../hooks/use-knowledge-base-draft.js";
import { KB_TEMPLATES, type KbTemplate } from "../lib/kb-templates.js";

/** Knowledge bases are pinned to the Claude Code harness (#2946): the install
 *  command and KB skills are exercised against it. Other harnesses stay hidden
 *  until KB templates carry their own harness choice. */
const KB_TEMPLATE_ID = "claude-code";

/** Create form. Same page structure and field pattern as the sandbox settings
 *  form ([sandbox-setup-section]): a gutter container (`md:px-8`) into which
 *  the standard field outdent (`FIELD_INSET` / `Inset`) resolves, so labels
 *  and controls align exactly as they do across the rest of the app. */
export function KnowledgeBaseCreateView() {
  const { draft, update, toggleConnection } = useKnowledgeBaseDraft();
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);

  const template = (templates ?? []).find((t) => t.id === KB_TEMPLATE_ID);
  const templateMissing = !templatesLoading && !template;

  const canCreate =
    draft.name.trim().length > 0 &&
    draft.providerRef !== null &&
    template !== undefined &&
    !createKnowledgeBase.isPending;

  const create = async () => {
    if (!template) return;
    try {
      const size = sizeToQuantities(draft.sizeCpuMilli, draft.sizeMemoryMi);
      const connectionIds = [
        ...draft.connectionIds,
        ...(draft.providerRef ? [draft.providerRef.id] : []),
      ];
      const agent = await createKnowledgeBase.mutateAsync({
        name: draft.name.trim(),
        // Harness image is pinned and hidden; the KB template is the picked
        // installation procedure.
        templateId: template.id,
        kbTemplateId: draft.kbTemplateId,
        egressPreset: draft.egressPreset,
        ...(size ? { size } : {}),
        ...(connectionIds.length ? { connectionIds } : {}),
      });
      openKnowledgeBase(agent.id);
    } catch {
      // The mutation surfaces its own error toast; stay here to retry.
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-10 pb-16 md:px-8">
      <PageHeader
        title="New knowledge base"
        description="A knowledge base is an agent that sets itself up and maintains knowledge for you. Create it, then feed it sources and ask questions in chat."
      />

      {templateMissing && (
        <p className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-warning">
          The knowledge-base agent image is not installed on this platform, so
          knowledge bases cannot be created. Ask your operator to enable it.
        </p>
      )}

      <section className="mb-8">
        <SectionLabel spaced>Template</SectionLabel>
        <div className="flex flex-col gap-3">
          {KB_TEMPLATES.map((tpl) => (
            <TemplateOption
              key={tpl.id}
              template={tpl}
              selected={draft.kbTemplateId === tpl.id}
              onSelect={() => update({ kbTemplateId: tpl.id })}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Name</SectionLabel>
        <Input
          autoFocus
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="e.g. spyre-codebase-knowledge"
        />
      </section>

      <SandboxSizeSection
        templateSize={template?.size}
        sizeCpuMilli={draft.sizeCpuMilli}
        sizeMemoryMi={draft.sizeMemoryMi}
        onChange={update}
      />

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <ProviderSection
          selected={draft.providerRef}
          onSelect={(ref) => update({ providerRef: ref })}
          onProviderRemoved={(ref) => {
            if (draft.providerRef && sameProviderRef(draft.providerRef, ref))
              update({ providerRef: null });
          }}
          autoSelectFirst
        />
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <div className="flex flex-col gap-3">
          {NETWORK_PRESETS.map((preset) => (
            <NetworkPresetRow
              key={preset.value}
              label={preset.label}
              help={preset.help}
              selected={draft.egressPreset === preset.value}
              onSelect={() => update({ egressPreset: preset.value })}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <KnowledgeBaseConnections
          connectionIds={draft.connectionIds}
          onToggle={toggleConnection}
        />
      </section>

      <div className="flex gap-2">
        <Button onClick={() => void create()} disabled={!canCreate}>
          {createKnowledgeBase.isPending
            ? "Creating…"
            : "Create knowledge base"}
        </Button>
        <Button variant="outline" onClick={navigateToKnowledgeBases}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TemplateOption({
  template,
  selected,
  onSelect,
}: {
  template: KbTemplate;
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
        {template.name}
      </p>
      <p className="text-[14px] text-muted-foreground">
        {template.description}
      </p>
    </button>
  );
}

function KnowledgeBaseConnections({
  connectionIds,
  onToggle,
}: {
  connectionIds: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const connectionsQ = useAppConnections();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const grantedIds = useMemo(() => new Set(connectionIds), [connectionIds]);
  const staged = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(staged);

  return (
    <>
      <GrantedConnectionsPanel
        groups={groups}
        templateById={templateById}
        onToggleGrant={onToggle}
        onOpenCatalog={() => setCatalogOpen(true)}
        inset={false}
      />
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: onToggle }}
          oauthReturnView="/knowledge-bases/new"
        />
      )}
    </>
  );
}
