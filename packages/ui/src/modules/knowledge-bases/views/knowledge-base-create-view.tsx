import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FIELD_INSET } from "@/components/ui/inset";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import type { TemplateView } from "../../../types.js";
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

/** Knowledge bases are pinned to the Claude Code harness (#2946): the install
 *  instruction and KB skills are exercised against it. Other harnesses stay
 *  hidden until KB templates carry their own harness choice. */
const KB_TEMPLATE_ID = "claude-code";

export function KnowledgeBaseCreateView() {
  const { draft, update, toggleConnection } = useKnowledgeBaseDraft();
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const createKnowledgeBase = useCreateKnowledgeBase();
  const selectAgent = useStore((s) => s.selectAgent);
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
        templateId: template.id,
        egressPreset: draft.egressPreset,
        ...(size ? { size } : {}),
        ...(connectionIds.length ? { connectionIds } : {}),
      });
      selectAgent(agent.id);
    } catch {
      // The mutation surfaces its own error toast; stay here to retry.
    }
  };

  return (
    <div className="mx-auto w-full max-w-[666px]">
      <PageHeader
        title="New knowledge base"
        description="A knowledge base is an agent that sets itself up and maintains knowledge for you. Create it, then feed it sources and ask questions in chat."
      />

      <section className="mb-8">
        <FormField label="Name">
          <Input
            autoFocus
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="e.g. spyre-codebase-knowledge"
          />
        </FormField>
      </section>

      <PinnedImageSection template={template} missing={templateMissing} />

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
          listClassName={FIELD_INSET}
        />
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <div className="flex flex-col gap-2">
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

      <KnowledgeBaseConnectionsSection
        connectionIds={draft.connectionIds}
        onToggle={toggleConnection}
      />

      <div className="mb-10 flex gap-2">
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

function PinnedImageSection({
  template,
  missing,
}: {
  template: TemplateView | undefined;
  missing: boolean;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Image</SectionLabel>
      {missing ? (
        <Card className="border border-destructive/40 px-4 py-3 text-[14px] text-muted-foreground">
          The {KB_TEMPLATE_ID} template is not installed on this platform, so
          knowledge bases cannot be created. Ask your operator to enable it.
        </Card>
      ) : (
        <Card className="flex items-center justify-between border border-border px-4 py-3">
          <span className="text-[14px] font-medium text-foreground">
            {template?.name ?? "…"}
          </span>
          <span className="text-[13px] text-muted-foreground font-mono">
            {template?.image ?? ""}
          </span>
        </Card>
      )}
    </section>
  );
}

function KnowledgeBaseConnectionsSection({
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
    <section className="mb-8">
      <GrantedConnectionsPanel
        groups={groups}
        templateById={templateById}
        onToggleGrant={onToggle}
        onOpenCatalog={() => setCatalogOpen(true)}
      />
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: onToggle }}
          oauthReturnView="/knowledge-bases/new"
        />
      )}
    </section>
  );
}
