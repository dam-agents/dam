import { useEffect, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useFeatures } from "../../features/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import { useTemplates } from "../../templates/api/queries.js";
import { GrantedConnectionsPanel } from "../components/granted-connections-panel.js";
import { CustomImageCard } from "../components/steps/custom-image-card.js";
import { HarnessCard } from "../components/steps/harness-card.js";
import { imageCatalogue } from "../lib/image-catalogue.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { generateSandboxName } from "../lib/sandbox-name.js";

export function CodingAgentSetupView() {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>("claude-code");
  const [customImage, setCustomImage] = useState("");
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { data: templates = [] } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const creating = createAgent.isPending;

  const catalogue = imageCatalogue(templates, {
    vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
  });

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

  const canCreate =
    name.trim().length > 0 &&
    providerRef !== null &&
    (templateId !== null || customImage.trim().length > 0);

  const finish = async () => {
    const allConnectionIds = [
      ...connectionIds,
      ...(providerRef ? [providerRef.id] : []),
    ];

    try {
      const agent = await createAgent.mutateAsync({
        name: name.trim(),
        ...(templateId ? { templateId } : {}),
        ...(customImage.trim() && !templateId
          ? { customImage: customImage.trim() }
          : {}),
        ...(allConnectionIds.length
          ? { appConnectionIds: allConnectionIds }
          : {}),
      });
      selectAgent(agent.id);
    } catch {
      // Mutation surfaces its own error toast
    }
  };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    setCustomImage("");
  };

  const handleCustomImageChange = (value: string) => {
    setCustomImage(value);
    if (value.trim()) setTemplateId(null);
  };

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-[24px] font-semibold text-foreground tracking-tight">
          Setup your coding agent
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Name your agent, choose an image, select a provider, and add
          connections.
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
              placeholder="my-coding-agent"
            />
          </FormField>
        </section>

        {/* Image template */}
        <section>
          <SectionLabel spaced>Image</SectionLabel>
          <Inset>
            <div className="grid grid-cols-2 gap-3">
              {catalogue.harnesses.map((template) => (
                <HarnessCard
                  key={template.id}
                  template={template}
                  selected={template.id === templateId}
                  onSelect={() => pickTemplate(template.id)}
                />
              ))}
            </div>

            <div className="relative my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[14px] text-muted-foreground">
                or use a custom image
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <CustomImageCard
              value={customImage}
              selected={customImage.trim().length > 0}
              onChange={handleCustomImageChange}
              onSubmit={() => {}}
            />
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
            {creating ? "Creating…" : "Create coding agent"}
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
