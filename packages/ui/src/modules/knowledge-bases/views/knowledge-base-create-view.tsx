import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_INSET, Inset } from "@/components/ui/inset";
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
        templateId: template.id,
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

      <section className="mb-8">
        <FormField
          label="Image"
          hint={
            template ? (
              <span className="truncate font-mono">{template.image}</span>
            ) : undefined
          }
        >
          <PinnedImage template={template} missing={templateMissing} />
        </FormField>
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
          listClassName={FIELD_INSET}
        />
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <Inset className="flex flex-col gap-3">
          {NETWORK_PRESETS.map((preset) => (
            <NetworkPresetRow
              key={preset.value}
              label={preset.label}
              help={preset.help}
              selected={draft.egressPreset === preset.value}
              onSelect={() => update({ egressPreset: preset.value })}
            />
          ))}
        </Inset>
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

const READ_ONLY_FIELD =
  "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-4 text-sm";

function PinnedImage({
  template,
  missing,
}: {
  template: TemplateView | undefined;
  missing: boolean;
}) {
  if (missing)
    return (
      <p className="text-[13px] text-warning">
        The {KB_TEMPLATE_ID} template is not installed on this platform, so
        knowledge bases cannot be created. Ask your operator to enable it.
      </p>
    );
  return (
    <div className={READ_ONLY_FIELD}>
      <span className="truncate text-muted-foreground">
        {template?.name ?? "…"}
      </span>
    </div>
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
