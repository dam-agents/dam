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
import { useCreateExperimentSandbox } from "../../experiments/api/mutations.js";
import { routeToPath } from "../../platform/lib/routes.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import { setMockCreatedKind } from "../../sessions/views/chat-view.js";
import { GrantedConnectionsPanel } from "../components/granted-connections-panel.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { generateSandboxName } from "../lib/sandbox-name.js";
import { KINDED_HARNESS_TEMPLATE_ID } from "../lib/wizard-snapshot.js";

export function ExperimentSetupView() {
  const [name, setName] = useState("");
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const createExperimentSandbox = useCreateExperimentSandbox();
  const selectAgent = useStore((s) => s.selectAgent);
  const creating = createExperimentSandbox.isPending;

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

  // Handle OAuth return from connection flow
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
      const agent = await createExperimentSandbox.mutateAsync({
        name: name.trim(),
        templateId: KINDED_HARNESS_TEMPLATE_ID,
        ...(allConnectionIds.length ? { connectionIds: allConnectionIds } : {}),
      });
      setMockCreatedKind("experiment");
      selectAgent(agent.id);
    } catch {
      // Mutation surfaces its own error toast
    }
  };

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-[24px] font-semibold text-foreground tracking-tight">
          Setup your experiment
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Name your experiment, choose a provider, and add connections.
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
              placeholder="my-experiment"
            />
          </FormField>
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
            {creating ? "Creating…" : "Create experiment"}
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
