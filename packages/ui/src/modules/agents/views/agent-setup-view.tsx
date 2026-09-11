import {
  Add,
  Checkmark,
  Close,
  Gift,
  Information,
  Launch,
  LogoGithub,
  TrashCan,
} from "@carbon/icons-react";
import type { ConnectionView, SkillSource } from "api-server-api";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, cardSelectionVariants } from "@/components/ui/card";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { repoSlug } from "@/lib/git-source";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "../../connections/components/catalog-connection-row.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { ConnectionRowActions } from "../../connections/components/connection-row-actions.js";
import { ConnectionStatusBadge } from "../../connections/components/connection-status-badge.js";
import {
  catalogProviderTitle,
  connectionKindSubtitle,
} from "../../connections/lib/catalog-providers.js";
import { useFeatures } from "../../features/api/queries.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import { PackIngredientSummary } from "../../packs/components/pack-ingredient-summary.js";
import type { Pack, PackSlot } from "../../packs/data/packs.js";
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
import { AddSkillSourceModal } from "../../sandboxes/components/skills/add-skill-source-modal.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { ScheduleSetupSection } from "../../schedules/components/schedule-setup-section.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  buildCodingAgentSetupInput,
  type CodingAgentSetupDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
} from "../lib/create-agent-input.js";

const RETURN_PATH = routeToPath({ view: "agent-new" });

export function AgentSetupView() {
  const pendingPack = useStore((s) => s.pendingPack);
  const setPendingPack = useStore((s) => s.setPendingPack);
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
        const filledKinds = new Set(["harness", "schedule", "skill"]);
        const missingSlots = allSlots.filter(
          (s) =>
            !filledKinds.has(s.kind) &&
            !(s.kind === "connection" && connectedSlots.includes(s)),
        );

        const summaryMsg = buildPackSummaryMessage(
          pendingPack,
          connectedSlots,
          missingSlots,
        );

        reset();
        setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
        setRegistryDisclosureOverride(null);
        useStore.getState().setCreatedFromPack(agentId, pendingPack.id);
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
      if (pendingPack) {
        useStore.getState().setCreatedFromPack(agent.id, pendingPack.id);
      }
      setPendingPack(null);
      selectAgent(agent.id);
    } catch {}
  };

  const { data: connectionTemplatesData } = useConnectionTemplates();
  const connectionTemplateIconMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of connectionTemplatesData ?? []) {
      if (t.iconSlug) map.set(t.id, t.iconSlug);
    }
    return map;
  }, [connectionTemplatesData]);

  const [browsePacksOpen, setBrowsePacksOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState<string | boolean>(false);
  const [dismissedSkills, setDismissedSkills] = useState<Set<string>>(
    new Set(),
  );
  const [dismissedRecommended, setDismissedRecommended] = useState<Set<string>>(
    new Set(),
  );
  const [addedSkillSources, setAddedSkillSources] = useState<SkillSource[]>([]);
  const [skillModalOpen, setSkillModalOpen] = useState(false);

  const presetScheduleIndices = useMemo(() => {
    const count = packDefaults.scheduleDrafts?.length ?? 0;
    if (count === 0) return undefined;
    return new Set(Array.from({ length: count }, (_, i) => i));
  }, [packDefaults.scheduleDrafts]);

  const recommendedSlots = useMemo(() => {
    if (!pendingPack) return [];
    return [...pendingPack.required, ...pendingPack.included].filter(
      (s) => s.kind === "connection" && s.connectionTemplateId,
    );
  }, [pendingPack]);

  const recommendedKbSlots = useMemo(() => {
    if (!pendingPack) return [];
    return [...pendingPack.required, ...pendingPack.included].filter(
      (s) => s.kind === "knowledge-base",
    );
  }, [pendingPack]);

  const skillSlots = useMemo(() => {
    if (!pendingPack) return [];
    return [...pendingPack.included, ...pendingPack.required].filter(
      (s) => s.kind === "skill",
    );
  }, [pendingPack]);

  const channelSlots = useMemo(() => {
    if (!pendingPack) return [];
    return [...pendingPack.included, ...pendingPack.required].filter(
      (s) => s.kind === "channel",
    );
  }, [pendingPack]);

  const visibleSkills = useMemo(
    () => skillSlots.filter((s) => !dismissedSkills.has(s.label)),
    [skillSlots, dismissedSkills],
  );

  const visibleRecommended = useMemo(
    () =>
      [...recommendedSlots, ...recommendedKbSlots].filter(
        (s) => !dismissedRecommended.has(`${s.kind}-${s.label}`),
      ),
    [recommendedSlots, recommendedKbSlots, dismissedRecommended],
  );

  const { unfulfilledSlots, fulfilledSlots } = useMemo(() => {
    const grantedTemplateIds = new Set(
      form.connectionIds
        .map((id) => userConnectionTemplateMap.get(id))
        .filter(Boolean),
    );
    const unfulfilled: PackSlot[] = [];
    const fulfilled: { slot: PackSlot; connection: ConnectionView }[] = [];
    for (const slot of visibleRecommended) {
      if (!slot.connectionTemplateId) {
        unfulfilled.push(slot);
        continue;
      }
      if (grantedTemplateIds.has(slot.connectionTemplateId)) {
        const conn = (userConnections ?? []).find(
          (c) =>
            c.templateId === slot.connectionTemplateId &&
            form.connectionIds.includes(c.id),
        );
        if (conn) {
          fulfilled.push({ slot, connection: conn });
          continue;
        }
      }
      unfulfilled.push(slot);
    }
    return { unfulfilledSlots: unfulfilled, fulfilledSlots: fulfilled };
  }, [
    visibleRecommended,
    form.connectionIds,
    userConnectionTemplateMap,
    userConnections,
  ]);

  const fulfilledConnectionIds = useMemo(
    () =>
      fulfilledSlots.length > 0
        ? new Set(fulfilledSlots.map((f) => f.connection.id))
        : undefined,
    [fulfilledSlots],
  );

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (channelSlots.length > 0) {
      const selected = new Set<string>();
      for (const slot of channelSlots) {
        const text =
          `${slot.label} ${slot.description} ${slot.demoValue ?? ""}`.toLowerCase();
        if (text.includes("slack") || text.includes("#")) selected.add("Slack");
        if (text.includes("telegram")) selected.add("Telegram");
      }
      if (selected.size === 0) selected.add("Slack");
      setSelectedChannels(selected);
    }
  }, [channelSlots]);

  const iconSlugForSlot = (slot: PackSlot) =>
    slot.connectionTemplateId
      ? connectionTemplateIconMap.get(slot.connectionTemplateId)
      : undefined;

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
      <Inset className="mb-8">
        {pendingPack ? (
          <PresetBar
            pack={pendingPack}
            onRemove={() => {
              setPendingPack(null);
              setDismissedSkills(new Set());
              setDismissedRecommended(new Set());
              reset();
            }}
            onChange={() => setBrowsePacksOpen(true)}
          />
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
              <Gift size={16} className="text-preset" />
            </div>
            <p className="flex-1 text-sm text-foreground/70">
              Want a head start? Pick a starter kit to pre-fill harness, skills,
              and connections.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBrowsePacksOpen(true)}
            >
              Browse starter kits
            </Button>
          </div>
        )}
      </Inset>

      <BrowsePacksModal
        open={browsePacksOpen}
        onClose={() => setBrowsePacksOpen(false)}
        onSelect={(pack) => {
          setPendingPack(pack);
          setDismissedSkills(new Set());
          setDismissedRecommended(new Set());
        }}
        onStartFromScratch={() => {
          setBrowsePacksOpen(false);
          setPendingPack(null);
          setDismissedSkills(new Set());
          setDismissedRecommended(new Set());
          reset();
        }}
      />

      <NameSection value={form.name} onChange={(name) => update({ name })} />

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
        onPickTemplate={(templateId) => update({ templateId, customImage: "" })}
        onCustomImageChange={(customImage) =>
          update({ customImage, templateId: null })
        }
        onSubmit={() => void create()}
      />

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("coding-agent")}
      />

      <ScheduleSetupSection
        drafts={form.scheduleDrafts}
        onDraftsChange={(scheduleDrafts) => update({ scheduleDrafts })}
        presetIndices={presetScheduleIndices}
      />

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
        excludeIds={fulfilledConnectionIds}
      >
        {(unfulfilledSlots.length > 0 || fulfilledSlots.length > 0) && (
          <div className="flex flex-col gap-3">
            {fulfilledSlots.map(({ slot, connection }) => (
              <ConnectedRecommendationCard
                key={`${slot.kind}-${slot.label}`}
                connection={connection}
                subtitle={connectionKindSubtitle(
                  connection,
                  connectionTemplatesData?.find(
                    (t) => t.id === connection.templateId,
                  ),
                )}
                providerTitle={catalogProviderTitle(connection.templateId)}
                iconSlug={iconSlugForSlot(slot)}
                grant={{
                  granted: true,
                  onToggle: (on) => {
                    update({
                      connectionIds: on
                        ? [...new Set([...form.connectionIds, connection.id])]
                        : form.connectionIds.filter((x) => x !== connection.id),
                    });
                  },
                  actionHidden: true,
                }}
              />
            ))}
            {unfulfilledSlots.map((slot) => (
              <RecommendedCard
                key={`${slot.kind}-${slot.label}`}
                slot={slot}
                iconSlug={iconSlugForSlot(slot)}
                packName={pendingPack?.name}
                onAdd={() => setCatalogOpen(slot.connectionTemplateId ?? true)}
                onDismiss={() =>
                  setDismissedRecommended(
                    (prev) => new Set([...prev, `${slot.kind}-${slot.label}`]),
                  )
                }
              />
            ))}
          </div>
        )}
      </ConnectionsSetupSection>

      <SkillsSetupSection
        presetSkills={visibleSkills}
        addedSources={addedSkillSources}
        onDismissPresetSkill={(label) =>
          setDismissedSkills((prev) => new Set([...prev, label]))
        }
        onRemoveSource={(id) =>
          setAddedSkillSources((prev) => prev.filter((s) => s.id !== id))
        }
        onOpenModal={() => setSkillModalOpen(true)}
      />
      {skillModalOpen && (
        <AddSkillSourceModal
          onClose={() => setSkillModalOpen(false)}
          onCreate={async (input) => {
            const source: SkillSource = {
              id: `src-${Date.now()}`,
              name: input.name,
              gitUrl: input.gitUrl,
              path: input.path,
            };
            setAddedSkillSources((prev) => [...prev, source]);
            setSkillModalOpen(false);
            return source;
          }}
          onCreateSkills={async () => ({ ok: true as const })}
        />
      )}

      <ChannelsSetupSection
        presetChannels={channelSlots}
        selectedChannels={selectedChannels}
        onToggleChannel={(label) =>
          setSelectedChannels((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
          })
        }
      />

      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{
            grantedIds: new Set(form.connectionIds),
            onToggleGrant: (id, on) =>
              update({
                connectionIds: on
                  ? [...new Set([...form.connectionIds, id])]
                  : form.connectionIds.filter((x) => x !== id),
              }),
          }}
          oauthReturnView={RETURN_PATH}
          initialTemplateId={
            typeof catalogOpen === "string" ? catalogOpen : undefined
          }
        />
      )}
    </SetupPageShell>
  );
}

export function PresetBar({
  pack,
  onRemove,
  onChange,
}: {
  pack: Pack;
  onRemove: () => void;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-preset-border/50 bg-preset-light/50 px-4 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
        <Gift size={16} className="text-preset" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-preset">{pack.name}</p>
        <div className="mt-0.5">
          <PackIngredientSummary pack={pack} />
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onChange}>
        Change
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        <Close size={16} />
      </Button>
    </div>
  );
}

export function RecommendedCard({
  slot,
  iconSlug,
  packName,
  onAdd,
  onDismiss,
}: {
  slot: PackSlot;
  iconSlug?: string;
  packName?: string;
  onAdd?: () => void;
  onDismiss?: () => void;
}) {
  const isKb = slot.kind === "knowledge-base";

  return (
    <Card className="overflow-hidden border-preset-border/50 bg-preset-light/50">
      {packName && slot.description && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-2.5 rounded-lg bg-preset-border/50 px-3 py-2.5">
            <Information size={16} className="mt-0.5 shrink-0 text-preset" />
            <p className="text-[14px] leading-relaxed text-foreground/80">
              {packName} needs {slot.label} access to{" "}
              {slot.description.toLowerCase()}
            </p>
          </div>
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-4 p-4",
          packName && slot.description && "border-t border-preset-border/30",
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
          <ConnectionIcon iconSlug={iconSlug} alt={slot.label} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {slot.label}
            </p>
            <Badge variant="preset">Starter Kit</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {slot.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isKb ? (
            <span className="text-sm text-muted-foreground/60">
              Coming soon
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onAdd}
            >
              <Add size={16} />
              Connect
            </Button>
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-preset-light/50 hover:text-foreground"
              onClick={onDismiss}
              aria-label={`Remove ${slot.label}`}
            >
              <Close size={16} />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ConnectedRecommendationCard({
  connection,
  subtitle,
  providerTitle,
  iconSlug,
  grant,
  maintenance,
  onManage,
  onDelete,
  deleting = false,
}: {
  connection: ConnectionView;
  subtitle: string;
  providerTitle?: string;
  iconSlug?: string;
  grant?: RowGrantControls;
  maintenance?: RowMaintenanceActions;
  onManage?: () => void;
  onDelete?: (id: string, name: string) => void;
  deleting?: boolean;
}) {
  return (
    <section className="rounded-lg border border-preset-border/50 bg-preset-light/50">
      <header className="flex h-[52px] items-center gap-2.5 border-b border-preset-border/30 px-4">
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
        <h3 className="min-w-0 truncate text-[15px] font-semibold text-foreground">
          {providerTitle ?? connection.name}
        </h3>
        <span className="shrink-0 text-sm text-muted-foreground">
          1 connection
        </span>
        <Badge variant="preset">Starter Kit</Badge>
      </header>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-[160px] flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] text-foreground">
                {connection.name}
              </p>
              {connection.status !== "active" && (
                <ConnectionStatusBadge status={connection.status} />
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <ConnectionRowActions
            connection={connection}
            grant={grant}
            maintenance={maintenance}
            onManage={onManage}
            onDelete={
              onDelete && (() => onDelete(connection.id, connection.name))
            }
            deleting={deleting}
          />
        </div>
      </div>
    </section>
  );
}

function SkillCard({
  slot,
  onDismiss,
}: {
  slot: PackSlot;
  onDismiss: () => void;
}) {
  return (
    <Card className="flex items-center gap-4 border-preset-border/50 bg-preset-light/50 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
        <Launch size={16} className="text-preset" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{slot.label}</p>
          <Badge variant="preset">Starter Kit</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {slot.description}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:bg-preset-light/50 hover:text-foreground"
        onClick={onDismiss}
        aria-label={`Remove ${slot.label}`}
      >
        <Close size={16} />
      </Button>
    </Card>
  );
}

export function SkillsSetupSection({
  presetSkills,
  addedSources,
  onDismissPresetSkill,
  onRemoveSource,
  onOpenModal,
}: {
  presetSkills: PackSlot[];
  addedSources: SkillSource[];
  onDismissPresetSkill: (label: string) => void;
  onRemoveSource: (id: string) => void;
  onOpenModal: () => void;
}) {
  const hasContent = presetSkills.length > 0 || addedSources.length > 0;

  if (!hasContent) {
    return (
      <section className="mb-8">
        <SectionLabel spaced>
          Skills{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </SectionLabel>
        <Callout inset className="bg-card">
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-center text-sm text-foreground/80">
              Add skill sources to extend this agent's capabilities
            </p>
            <Button variant="outline" onClick={onOpenModal}>
              <Add size={16} />
              Add skill source
            </Button>
          </div>
        </Callout>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Skills</SectionLabel>
        <Button variant="outline" size="sm" onClick={onOpenModal}>
          <Add size={16} />
          Add skill source
        </Button>
      </div>
      <Inset className="flex flex-col gap-3">
        {presetSkills.map((slot) => (
          <SkillCard
            key={slot.label}
            slot={slot}
            onDismiss={() => onDismissPresetSkill(slot.label)}
          />
        ))}
        {addedSources.map((source) => (
          <Card key={source.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LogoGithub size={16} className="shrink-0 text-foreground" />
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {source.name}
                  </p>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {repoSlug(source.gitUrl)}
                  {source.path ? ` · ${source.path}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveSource(source.id)}
                aria-label={`Remove ${source.name}`}
              >
                <TrashCan size={16} />
              </Button>
            </div>
          </Card>
        ))}
      </Inset>
    </section>
  );
}

export const AVAILABLE_CHANNELS: {
  id: string;
  label: string;
  description: string;
  iconSlug: string;
}[] = [
  {
    id: "slack",
    label: "In a Slack channel",
    description:
      "Your team can interact with the agent in a Slack channel or their DMs.",
    iconSlug: "slack",
  },
  {
    id: "telegram",
    label: "In a Telegram chat",
    description:
      "Your team can interact with the agent in a Telegram group or DM.",
    iconSlug: "telegram",
  },
];

export function ChannelsSetupSection({
  presetChannels,
  selectedChannels,
  onToggleChannel,
}: {
  presetChannels: PackSlot[];
  selectedChannels: Set<string>;
  onToggleChannel: (label: string) => void;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>
        <span className="flex items-center gap-2">
          Channels
          <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
      </SectionLabel>
      <Inset className="flex flex-col gap-3">
        {AVAILABLE_CHANNELS.map((ch) => {
          const matchesSlot = (s: PackSlot) => {
            const text =
              `${s.label} ${s.description} ${s.demoValue ?? ""}`.toLowerCase();
            return text.includes(ch.id);
          };
          const presetSlot = presetChannels.find(matchesSlot);
          const isFromPreset =
            presetChannels.length > 0 &&
            (!!presetSlot ||
              (ch.id === "slack" &&
                presetChannels.some((s) =>
                  (s.demoValue ?? "").startsWith("#"),
                )));
          const channelLabel = ch.id === "slack" ? "Slack" : "Telegram";
          const isSelected = selectedChannels.has(channelLabel);

          return (
            <ChannelCard
              key={ch.id}
              channel={ch}
              isSelected={isSelected}
              isFromPreset={isFromPreset}
              onToggle={() => onToggleChannel(channelLabel)}
            />
          );
        })}
      </Inset>
    </section>
  );
}

export function ChannelCard({
  channel,
  isSelected,
  isFromPreset,
  onToggle,
}: {
  channel: (typeof AVAILABLE_CHANNELS)[number];
  isSelected: boolean;
  isFromPreset: boolean;
  onToggle: () => void;
}) {
  const isPresetSelected = isSelected && isFromPreset;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        isPresetSelected
          ? cn(
              "flex items-center gap-3 rounded-lg border border-preset-border/50 bg-preset-light/50 px-4 py-3 text-left transition-colors",
            )
          : cardSelectionVariants({
              selected: isSelected,
              className: "flex items-center gap-3 px-4 py-3 text-left",
            })
      }
    >
      <span className="shrink-0">
        <ConnectionIcon iconSlug={channel.iconSlug} alt="" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {channel.label}
          </span>
          {isFromPreset && <Badge variant="preset">Starter Kit</Badge>}
        </span>
        <span className="block text-sm text-muted-foreground">
          {channel.description}
        </span>
      </span>
      <span className="ml-auto shrink-0">
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-[3px] border",
            isPresetSelected
              ? "border-preset bg-preset"
              : isSelected
                ? "border-foreground bg-foreground"
                : "border-muted-foreground/50",
          )}
        >
          {isSelected && <Checkmark size={12} className="text-white" />}
        </span>
      </span>
    </button>
  );
}
