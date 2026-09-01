import { Categories, Close } from "@carbon/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import type { Pack } from "../../packs/data/packs.js";
import { mockCreateAgentFromPack } from "../../packs/lib/mock-create-from-pack.js";
import { buildPackSummaryMessage } from "../../packs/lib/pack-summary-message.js";
import { packToSetupDefaults } from "../../packs/lib/pack-to-setup-defaults.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { ScheduleSetupSection } from "../../schedules/components/schedule-setup-section.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import {
  buildCodingAgentSetupInput,
  type CodingAgentSetupDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
} from "../lib/create-agent-input.js";
import { nextNameWithPrefix } from "../lib/sandbox-name.js";

const RETURN_PATH = routeToPath({ view: "agent-new" });

export function AgentSetupView() {
  const pendingPack = useStore((s) => s.pendingPack);
  const setPendingPack = useStore((s) => s.setPendingPack);
  const { data: agentsData } = useAgents();
  const { data: userConnections } = useAppConnections();

  const userConnectionTemplateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of userConnections ?? []) {
      if (c.templateId) map.set(c.id, c.templateId);
    }
    return map;
  }, [userConnections]);

  const packDefaults = useMemo(() => {
    if (!pendingPack) return {};
    const userConnIds = (userConnections ?? []).map((c) => c.id);
    return packToSetupDefaults(
      pendingPack,
      userConnIds,
      userConnectionTemplateMap,
    );
  }, [pendingPack, userConnections, userConnectionTemplateMap]);

  const packRef = useRef(pendingPack);
  useLayoutEffect(() => {
    if (pendingPack && pendingPack !== packRef.current) {
      sessionStorage.removeItem("platform-setup-coding-agent");
    }
    packRef.current = pendingPack;
  }, [pendingPack]);

  const { form, update, reset } = useSetupForm(
    "coding-agent",
    pendingPack ? { ...packDefaults, name: "" } : {},
    RETURN_PATH,
  );

  const takenNames = useMemo(
    () => (agentsData?.list ?? []).map((a) => a.name),
    [agentsData],
  );

  const namePrefilledRef = useRef(false);
  useEffect(() => {
    if (!pendingPack || namePrefilledRef.current) return;
    if (form.name && !form.name.startsWith(pendingPack.id)) return;
    const slug = pendingPack.id;
    const suggested = nextNameWithPrefix(slug, takenNames);
    update({ name: suggested });
    namePrefilledRef.current = true;
  }, [pendingPack, form.name, takenNames, update]);

  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);

  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);

  const catalogue = useMemo(
    () =>
      imageCatalogue(templates ?? [], {
        vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
      }),
    [templates, flags],
  );

  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || catalogue.harnesses.length === 0) return;
    preselected.current = true;
    if (form.templateId !== null || form.customImage.trim().length > 0) return;
    if (catalogue.harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
      update({ templateId: KINDED_HARNESS_TEMPLATE_ID });
    }
  }, [catalogue.harnesses, form.templateId, form.customImage, update]);

  const isPending = createAgent.isPending;

  const canCreate = (() => {
    if (isPending) return false;
    if (form.name.trim().length === 0 || form.providerRef === null)
      return false;
    const draft: CodingAgentSetupDraft = {
      name: form.name,
      templateId: form.templateId,
      customImage: form.customImage,
      providerRef: form.providerRef,
      connectionIds: form.connectionIds,
      registryCredential,
    };
    return isCodingAgentSetupComplete(draft);
  })();

  const registryPartial = hasPartialRegistryCredential({
    name: form.name,
    templateId: form.templateId,
    customImage: form.customImage,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
    registryCredential,
  });

  const create = async () => {
    if (!canCreate) return;
    try {
      if (import.meta.env.VITE_MOCK && pendingPack) {
        const agentId = mockCreateAgentFromPack(
          pendingPack,
          form.name,
          form.templateId,
        );

        const allSlots = [...pendingPack.included, ...pendingPack.required];
        const connectionSlots = allSlots.filter((s) => s.kind === "connection");
        const connectedSlots = connectionSlots.filter((s) =>
          s.connectionTemplateId
            ? [...userConnectionTemplateMap.values()].includes(
                s.connectionTemplateId,
              )
            : false,
        );
        const missingSlots = allSlots.filter(
          (s) =>
            s.kind === "knowledge-base" ||
            (s.kind === "connection" && !connectedSlots.includes(s)),
        );

        const summaryMsg = buildPackSummaryMessage(
          pendingPack,
          connectedSlots,
          missingSlots,
        );

        reset();
        setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
        setRegistryDisclosureOverride(null);
        setPendingPack(null);
        selectAgent(agentId);
        useStore.getState().setSessionId(`pack-session-${Date.now()}`);
        useStore.getState().setMessages([summaryMsg]);
        return;
      }

      const draft: CodingAgentSetupDraft = {
        name: form.name,
        templateId: form.templateId,
        customImage: form.customImage,
        providerRef: form.providerRef,
        connectionIds: form.connectionIds,
        registryCredential,
      };
      const agent = await createAgent.mutateAsync(
        buildCodingAgentSetupInput(draft),
      );
      reset();
      setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
      setRegistryDisclosureOverride(null);
      setPendingPack(null);
      selectAgent(agent.id);
    } catch {}
  };

  const setView = useStore((s) => s.setView);

  return (
    <SetupPageShell
      title="Create an agent"
      subtitle="Configure your agent with a name, harness, and connections."
      footer={
        <>
          {registryPartial && (
            <p className="text-sm text-destructive">
              Finish or clear the private-registry credentials.
            </p>
          )}
          <Button onClick={() => void create()} disabled={!canCreate}>
            {isPending ? "Creating…" : "Create agent"}
          </Button>
        </>
      }
    >
      {pendingPack ? (
        <PackBanner
          pack={pendingPack}
          onRemove={() => {
            setPendingPack(null);
            namePrefilledRef.current = false;
            reset();
          }}
        />
      ) : (
        <Callout
          tone="muted"
          className="flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <Categories size={16} className="shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Want a head start? Pick a pack to pre-fill harness, skills, and
              connections.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setView("packs")}>
            Browse packs
          </Button>
        </Callout>
      )}

      <NameSection value={form.name} onChange={(name) => update({ name })} />
      <div className="relative">
        {pendingPack && packDefaults.templateId && (
          <PackFieldBadge packName={pendingPack.name} />
        )}
        <ImageSection
          harnesses={catalogue.harnesses}
          loading={isLoading}
          templateId={form.templateId}
          customImage={form.customImage}
          registry={{
            value: registryCredential,
            onChange: setRegistryCredential,
            partial: registryPartial,
            disclosureOverride: registryDisclosureOverride,
            onDisclosureOverride: setRegistryDisclosureOverride,
          }}
          onPickTemplate={(templateId) =>
            update({ templateId, customImage: "" })
          }
          onCustomImageChange={(customImage) =>
            update({ customImage, templateId: null })
          }
          onSubmit={() => void create()}
        />
      </div>
      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("coding-agent")}
      />
      <div className="relative">
        {pendingPack &&
          packDefaults.scheduleDrafts &&
          packDefaults.scheduleDrafts.length > 0 && (
            <PackFieldBadge packName={pendingPack.name} />
          )}
        <ScheduleSetupSection
          drafts={form.scheduleDrafts}
          onDraftsChange={(scheduleDrafts) => update({ scheduleDrafts })}
        />
      </div>
      <div className="relative">
        {pendingPack &&
          packDefaults.connectionIds &&
          packDefaults.connectionIds.length > 0 && (
            <PackFieldBadge packName={pendingPack.name} />
          )}
        <ConnectionsSetupSection
          connectionIds={form.connectionIds}
          onToggle={(id, granted) =>
            update({
              connectionIds: granted
                ? [...new Set([...form.connectionIds, id])]
                : form.connectionIds.filter((x) => x !== id),
            })
          }
          oauthReturnView={RETURN_PATH}
        />
      </div>
    </SetupPageShell>
  );
}

function PackBanner({ pack, onRemove }: { pack: Pack; onRemove: () => void }) {
  const Icon = pack.icon;
  const missingRequired = pack.required.filter(
    (s) => s.kind === "knowledge-base" || s.kind === "channel",
  );

  return (
    <Callout tone="info" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <Icon size={16} className="text-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Creating from {pack.name}
            </p>
            <p className="text-[14px] text-muted-foreground">{pack.tagline}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onRemove}>
          <Close size={16} />
        </Button>
      </div>
      {missingRequired.length > 0 && (
        <div className="text-[14px] text-muted-foreground">
          <span className="font-medium">Still needed after create:</span>{" "}
          {missingRequired.map((s) => s.label).join(", ")}
        </div>
      )}
    </Callout>
  );
}

function PackFieldBadge({ packName }: { packName: string }) {
  return (
    <div className="absolute -top-3 right-0 z-10">
      <Badge variant="accent" size="sm">
        From {packName}
      </Badge>
    </div>
  );
}
