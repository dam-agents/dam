import { Book, DocumentMultiple_01 } from "@carbon/icons-react";
import { useEffect, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useCreateKnowledgeBase } from "../../knowledge-bases/api/mutations.js";
import {
  DEFAULT_KB_TEMPLATE_ID,
  KB_TEMPLATES,
} from "../../knowledge-bases/lib/kb-templates.js";
import { routeToPath } from "../../platform/lib/routes.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import { GrantedConnectionsPanel } from "../components/granted-connections-panel.js";
import { SelectableCard } from "../components/steps/selectable-card.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { generateSandboxName } from "../lib/sandbox-name.js";
import { KINDED_HARNESS_TEMPLATE_ID } from "../lib/wizard-snapshot.js";

export function KnowledgeBaseSetupView() {
  const [name, setName] = useState("");
  const [kbTemplateId, setKbTemplateId] = useState<string>(
    DEFAULT_KB_TEMPLATE_ID,
  );
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const creating = createKnowledgeBase.isPending;

  const connectionsQ = useAppConnections();
  const grantedIds = useMemo(() => new Set(connectionIds), [connectionIds]);
  const toggle = (id: string, on: boolean) =>
    setConnectionIds((prev) =>
      on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );

  const staged = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(staged);

  useEffect(() => {
    if (!name.trim()) {
      setName(generateSandboxName());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    window.history.replaceState({}, "", routeToPath({ view: "sandbox-new" }));
    const connectionId = params.get("connection");
    if (result === "success" && connectionId) {
      setConnectionIds((prev) => [...new Set([...prev, connectionId])]);
    } else if (result !== "success") {
      emitToast({
        kind: "error",
        message: `Connection authorization failed: ${params.get("message") ?? "unknown error"}`,
      });
    }
  }, []);

  const canCreate = name.trim().length > 0 && providerRef !== null;

  const finish = async () => {
    const allConnectionIds = [
      ...connectionIds,
      ...(providerRef ? [providerRef.id] : []),
    ];

    try {
      const agent = await createKnowledgeBase.mutateAsync({
        name: name.trim(),
        templateId: KINDED_HARNESS_TEMPLATE_ID,
        kbTemplateId: kbTemplateId as "llm-wiki" | "plain-wiki",
        ...(allConnectionIds.length ? { connectionIds: allConnectionIds } : {}),
      });
      openKnowledgeBase(agent.id);
    } catch {
      // Mutation surfaces its own error toast
    }
  };

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-[24px] font-semibold text-foreground tracking-tight">
          Setup your knowledge base
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Name your knowledge base, choose a template, and add connections.
        </p>
      </div>

      <div className="space-y-8">
        {/* Name */}
        <section>
          <FormField label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-knowledge-base"
            />
          </FormField>
        </section>

        {/* Templates */}
        <section>
          <SectionLabel spaced>Template</SectionLabel>
          <Inset>
            <div className="grid grid-cols-2 gap-3">
              {KB_TEMPLATES.map((template) => (
                <SelectableCard
                  key={template.id}
                  selected={kbTemplateId === template.id}
                  onSelect={() => setKbTemplateId(template.id)}
                  ariaLabel={template.name}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6] bg-background/80">
                        {template.id === "llm-wiki" ? (
                          <Book size={20} />
                        ) : (
                          <DocumentMultiple_01 size={20} />
                        )}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-foreground">
                        {template.name}
                      </p>
                      <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                  </div>
                </SelectableCard>
              ))}
            </div>
          </Inset>
        </section>

        {/* Provider */}
        <section>
          <SectionLabel spaced>Provider</SectionLabel>
          <Inset>
            <ProviderSelect
              selected={providerRef}
              onSelect={setProviderRef}
              autoSelectFirst
              allow={["ibm-litellm", "anthropic"]}
              recommended="ibm-litellm"
            />
          </Inset>
        </section>

        {/* Connections */}
        <section>
          <GrantedConnectionsPanel
            groups={groups}
            templateById={templateById}
            onToggleGrant={toggle}
            onOpenCatalog={() => setCatalogOpen(true)}
          />
        </section>

        {/* Create button */}
        <div className="pt-4 flex justify-end">
          <Button onClick={finish} disabled={!canCreate || creating}>
            {creating ? "Creating…" : "Create knowledge base"}
          </Button>
        </div>
      </div>

      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: toggle }}
          oauthReturnView={routeToPath({ view: "sandbox-new" })}
        />
      )}
    </div>
  );
}
