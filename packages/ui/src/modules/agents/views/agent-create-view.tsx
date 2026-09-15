import { CheckmarkFilled, CircleDash, Close, Gift } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { FIELD_INSET, Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { sizeInMi, slotsFor, slotUnitOf } from "../../budgets/lib/slots.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useFeatures } from "../../features/api/queries.js";
import { ConnectedKnowledgeBasesSetup } from "../../knowledge-bases/components/connected-knowledge-bases-setup.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import { HarnessGrid } from "../../sandboxes/components/setup/harness-grid.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { useHarnessCatalogue } from "../../sandboxes/hooks/use-harness-catalogue.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  narrowPolicyToTemplate,
  setupProviderPolicy,
} from "../../sandboxes/lib/setup-policy.js";
import { useApplyStarterKit } from "../../starter-kits/api/mutations.js";
import { useStarterKit } from "../../starter-kits/api/queries.js";
import { BrowseKitsModal } from "../../starter-kits/components/browse-kits-modal.js";
import { KitScheduleCard } from "../../starter-kits/components/kit-schedule-card.js";
import { kitBadges } from "../../starter-kits/lib/catalog-cards.js";
import {
  allowedHarnesses,
  buildStarterKitApplyInput,
  type ConnectTarget,
  connectTargets,
  describeAccepts,
  harnessesLine,
  isProviderRequirement,
  isStarterKitSetupComplete,
  kitResourcesLine,
  ownAgentLine,
  ownedMatches,
  preselectedGrants,
  providerPolicyForKit,
  requirementStatuses,
  type StarterKitSetupDraft,
  toggleSkipped,
  withOverride,
} from "../../starter-kits/lib/setup.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  buildCodingAgentSetupInput,
  type CodingAgentSetupDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
} from "../lib/create-agent-input.js";

export function StarterKitSetupView() {
  const catalog = useStore((s) => s.starterKitCatalog);
  const kitId = useStore((s) => s.starterKitId);
  const kit = useStarterKit(catalog, kitId);
  const setView = useStore((s) => s.setView);
  if (kit.isPending) {
    return <ListSkeleton rows={3} rowHeight={80} />;
  }
  if (kit.isError || kit.data === undefined) {
    return (
      <Callout tone="danger">
        <p className="text-sm text-foreground">
          Couldn&apos;t load this starter kit. It may have been removed from the
          catalog, or the catalog is unreachable.
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void kit.refetch()}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("starter-kits")}
          >
            All kits
          </Button>
        </div>
      </Callout>
    );
  }
  return <AgentCreateView kit={kit.data} />;
}

export function AgentCreateView({ kit }: { kit: StarterKitView | null }) {
  const returnPath = kit
    ? routeToPath({
        view: "starter-kit-new",
        catalog: kit.catalog,
        kit: kit.id,
      })
    : routeToPath({ view: "coding-agent-new" });
  const { form, update, toggleConnection, reset } = useSetupForm(
    kit ? "starter-kit" : "coding-agent",
    kit ? { name: kit.id } : {},
    returnPath,
    kit ? `${kit.catalog}/${kit.id}` : undefined,
  );
  const apply = useApplyStarterKit();
  const createAgent = useCreateAgent();
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const budget = useBudgetReserved();
  const [browsingKits, setBrowsingKits] = useState(false);
  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);
  const selectAgent = useStore((s) => s.selectAgent);
  const setView = useStore((s) => s.setView);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const connections = useAppConnections();
  const templates = useTemplates();
  const connectionTemplates = useConnectionTemplates();
  const templateById = useMemo(
    () => new Map((connectionTemplates.data ?? []).map((t) => [t.id, t])),
    [connectionTemplates.data],
  );
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(
    null,
  );
  const grantedIds = useMemo(
    () => new Set(form.connectionIds),
    [form.connectionIds],
  );

  const onTemplateIdChange = useCallback(
    (templateId: string | null) => update({ templateId }),
    [update],
  );
  const catalogue = useHarnessCatalogue({
    templateId: form.templateId,
    allowNone: kit ? false : form.customImage.trim().length > 0,
    onTemplateIdChange,
  });

  const bringsImage = kit?.image !== undefined;
  const resourcesLine = kit ? kitResourcesLine(kit) : undefined;
  const kitSlots = useMemo(() => {
    if (!kit?.resources || !budget.data) return null;
    const mi = sizeInMi(kit.resources);
    if (mi.cpuMilli === 0 && mi.memoryMi === 0) return null;
    return slotsFor(mi, slotUnitOf(budget.data));
  }, [kit?.resources, budget.data]);
  const harnesses = kit
    ? allowedHarnesses(kit, catalogue.harnesses)
    : catalogue.harnesses;
  const noHarnessInstalled =
    kit !== null &&
    !bringsImage &&
    kit.harnesses !== undefined &&
    !catalogue.isLoading &&
    harnesses.length === 0;
  const harnessAllowed =
    bringsImage || harnesses.some((t) => t.id === form.templateId);

  const draft: StarterKitSetupDraft = {
    name: form.name,
    templateId: form.templateId,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
    slackChannelId: form.slackChannelId,
    skippedSchedules: form.skippedSchedules,
    scheduleOverrides: form.scheduleOverrides,
  };
  const owned = connections.data ?? [];
  const statuses = kit
    ? requirementStatuses(kit, draft, owned, templateById)
    : [];
  const preselected = useRef(false);
  useEffect(() => {
    if (!kit) return;
    if (preselected.current) return;
    if (
      connections.data === undefined ||
      connectionTemplates.data === undefined
    )
      return;
    preselected.current = true;
    for (const id of preselectedGrants(
      kit,
      connections.data,
      form.connectionIds,
      templateById,
    ))
      toggleConnection(id, true);
  }, [
    kit,
    connections.data,
    connectionTemplates.data,
    templateById,
    form.connectionIds,
    toggleConnection,
  ]);
  const providerSource =
    kit && bringsImage
      ? kit.image
      : (templates.data?.find((t) => t.id === form.templateId) ?? null);
  const providerPolicy = kit
    ? narrowPolicyToTemplate(
        providerPolicyForKit(kit, setupProviderPolicy("starter-kit")),
        providerSource,
      )
    : setupProviderPolicy("coding-agent");
  const noCompatibleProvider = (providerPolicy.allow?.length ?? 1) === 0;

  const plainDraft: CodingAgentSetupDraft = {
    name: form.name,
    templateId: form.templateId,
    customImage: form.customImage,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
    registryCredential,
  };
  const registryPartial = hasPartialRegistryCredential(plainDraft);
  const pending = kit ? apply.isPending : createAgent.isPending;
  const canApply = kit
    ? isStarterKitSetupComplete(kit, draft, owned, templateById) &&
      harnessAllowed &&
      !noCompatibleProvider &&
      !pending
    : isCodingAgentSetupComplete(plainDraft) && !pending;

  const create = async () => {
    if (!canApply) return;
    if (!kit) {
      try {
        const agent = await createAgent.mutateAsync(
          buildCodingAgentSetupInput(plainDraft),
        );
        reset();
        setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
        setRegistryDisclosureOverride(null);
        selectAgent(agent.id);
      } catch {}
      return;
    }
    try {
      const result = await apply.mutateAsync(
        buildStarterKitApplyInput(kit, draft, owned, templateById),
      );
      reset();
      const skipped = result.skills?.skipped.length ?? 0;
      if (result.skillsError) {
        emitToast({
          kind: "error",
          message: `Agent created, but its external skills could not be installed: ${result.skillsError}`,
        });
      } else if (skipped > 0) {
        emitToast({
          kind: "warning",
          message: `Agent created; ${skipped} external skill${skipped === 1 ? "" : "s"} could not be installed — see the Skills panel.`,
        });
      }
      selectAgent(result.agent.id);
    } catch {}
  };

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
          <Button onClick={() => void create()} disabled={!canApply}>
            {pending
              ? "Creating…"
              : kit
                ? "Create agent from this kit"
                : "Create coding agent"}
          </Button>
        </>
      }
    >
      {!kit && kitsEnabled && (
        <section className="mb-8">
          <Callout tone="default" inset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                Want a head start? Pick a starter kit to pre-fill your agent
                setup.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBrowsingKits(true)}
              >
                Browse starter kits
              </Button>
            </div>
          </Callout>
        </section>
      )}

      {browsingKits && (
        <BrowseKitsModal
          onPick={(catalog, kitId) => {
            setBrowsingKits(false);
            navigateToStarterKit(catalog, kitId);
          }}
          onClose={() => setBrowsingKits(false)}
          onStartFromScratch={() => setBrowsingKits(false)}
        />
      )}

      {kit && (
        <section className="mb-8">
          <Inset className="flex items-center gap-4 rounded-xl border border-kit-line bg-kit-surface px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-kit-tint text-kit">
              <Gift size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-6 text-foreground">
                {kit.name}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {kitBadges(
                  kit,
                  connectionTemplates.data ?? [],
                  templateById,
                ).map((b) => (
                  <Badge key={b.key} variant="kit" size="sm">
                    {b.label}
                  </Badge>
                ))}
                {resourcesLine && (
                  <Badge variant="kit" size="sm">
                    {resourcesLine}
                  </Badge>
                )}
              </div>
              {kitSlots !== null && kitSlots > 1 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Uses {kitSlots} of your compute slots while it runs. CPU and
                  memory stay editable on the agent; disk is fixed at create.
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView("starter-kits")}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Create a plain agent instead"
              onClick={() => setView("coding-agent-new")}
            >
              <Close size={16} />
            </Button>
          </Inset>
        </section>
      )}

      <NameSection value={form.name} onChange={(name) => update({ name })} />

      {!kit && (
        <ImageSection
          harnesses={catalogue.harnesses}
          loading={catalogue.isLoading}
          error={catalogue.isError}
          onRetry={catalogue.refetch}
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
      )}

      {kit && (
        <section className="mb-8">
          <SectionLabel spaced>Harness</SectionLabel>
          {bringsImage ? (
            <Callout tone="default" inset>
              <div>{ownAgentLine(kit)}. The harness is fixed by the kit.</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {kit.image?.ref}
              </div>
            </Callout>
          ) : noHarnessInstalled ? (
            <Callout tone="warning" inset>
              This kit runs on {harnessesLine(kit).replace(/^An agent on /, "")}
              , and none of those is installed here.
            </Callout>
          ) : (
            <HarnessGrid
              harnesses={harnesses}
              loading={catalogue.isLoading}
              error={catalogue.isError}
              onRetry={catalogue.refetch}
              templateId={form.templateId}
              onPick={(templateId) => update({ templateId })}
            />
          )}
        </section>
      )}

      {noCompatibleProvider ? (
        <section className="mb-8">
          <SectionLabel spaced>Provider</SectionLabel>
          <Callout tone="warning" inset>
            This kit asks for a provider that the chosen harness cannot run on.
            Pick another harness, or a kit whose provider fits.
          </Callout>
        </section>
      ) : (
        <ProviderSection
          selected={form.providerRef}
          onSelect={(providerRef) => update({ providerRef })}
          policy={providerPolicy}
        />
      )}

      {kit && statuses.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>
            {kit?.connections.some((c) => c.required)
              ? "Connections"
              : "Connections (optional)"}
          </SectionLabel>
          <ul className="space-y-2 text-sm">
            {statuses.map(({ requirement, satisfied }) => (
              <li
                key={requirement.accepts.join("|")}
                className="flex items-start gap-2"
              >
                {satisfied ? (
                  <CheckmarkFilled className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <CircleDash className="mt-0.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div>
                    {describeAccepts(requirement.accepts, templateById)}{" "}
                    <Badge variant="kit" size="sm">
                      Starter Kit
                    </Badge>{" "}
                    <span className="text-muted-foreground">
                      ({requirement.required ? "required" : "suggested"})
                    </span>
                  </div>
                  {requirement.note && (
                    <div className="text-muted-foreground">
                      {requirement.note}
                    </div>
                  )}
                  {!satisfied && isProviderRequirement(requirement) && (
                    <div className="mt-1 text-muted-foreground">
                      Pick one under Provider above.
                    </div>
                  )}
                  {!satisfied && !isProviderRequirement(requirement) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ownedMatches(requirement, owned, templateById).map(
                        (c) => (
                          <Button
                            key={`use-${c.id}`}
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleConnection(c.id, true)}
                            data-testid={`starter-kit-use-${c.id}`}
                          >
                            Use {c.name ?? c.id}
                          </Button>
                        ),
                      )}
                      {connectTargets(requirement, templateById).map((t) => (
                        <Button
                          key={t.key}
                          size="sm"
                          variant="outline"
                          onClick={() => setConnectTarget(t)}
                          data-testid={`starter-kit-connect-${t.key}`}
                        >
                          Connect {t.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConnectionsSetupSection
        connectionIds={form.connectionIds}
        onToggle={toggleConnection}
        oauthReturnView={returnPath}
      />
      {connectTarget && (
        <ConnectionCatalogModal
          initialProviderId={connectTarget.providerId}
          initialTemplateId={connectTarget.templateId}
          onClose={() => setConnectTarget(null)}
          sandbox={{ grantedIds, onToggleGrant: toggleConnection }}
          oauthReturnView={returnPath}
        />
      )}

      {kit && kit.channels.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Channels (optional)</SectionLabel>
          <ul className="flex flex-col gap-2">
            {kit.channels.map((channel) => (
              <li
                key={channel.type}
                className={cn(
                  FIELD_INSET,
                  "rounded-lg border border-border px-4 py-3",
                )}
              >
                <div className="flex items-start gap-3">
                  <ConnectionIcon
                    iconSlug={channel.type}
                    alt=""
                    size={16}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {channel.type === "slack"
                          ? "In a Slack channel"
                          : "In a Telegram chat"}
                      </span>
                      <Badge variant="kit" size="sm">
                        Starter Kit
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {channel.note ??
                        "Your team can interact with the agent in a channel or their DMs."}
                    </p>
                  </div>
                </div>
                {channel.type === "slack" && (
                  <div className="mt-3 pl-7">
                    <FormField
                      label="Slack channel ID"
                      disableInset
                      hint="From the channel's details in Slack — starts with C. The bot must be a member of the channel."
                    >
                      <Input
                        className="h-10"
                        value={form.slackChannelId}
                        onChange={(e) =>
                          update({ slackChannelId: e.target.value })
                        }
                        placeholder="C0…"
                        data-testid="starter-kit-slack-channel-id"
                      />
                    </FormField>
                  </div>
                )}
                {channel.type === "telegram" && (
                  <p className="mt-2 pl-7 text-xs text-muted-foreground">
                    Bound in chat with /platform bind after the agent is running
                    — no form can do it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {kit && kit.schedules.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Schedules</SectionLabel>
          <ul className={cn(FIELD_INSET, "flex flex-col gap-3")}>
            {kit.schedules.map((s) => (
              <KitScheduleCard
                key={s.name}
                schedule={s}
                override={form.scheduleOverrides.find((o) => o.name === s.name)}
                skipped={form.skippedSchedules.includes(s.name)}
                onChange={(patch) =>
                  update({
                    scheduleOverrides: withOverride(
                      form.scheduleOverrides,
                      s.name,
                      patch,
                    ),
                  })
                }
                onToggleSkipped={() =>
                  update({
                    skippedSchedules: toggleSkipped(
                      form.skippedSchedules,
                      s.name,
                    ),
                  })
                }
              />
            ))}
          </ul>
          <p className={cn(FIELD_INSET, "mt-3 text-sm text-muted-foreground")}>
            Created with the kit author&apos;s defaults and held until
            onboarding finishes. Adjust any of them, or skip what you do not
            want.
          </p>
        </section>
      )}

      {kit && (kit.skillsInKit.length > 0 || kit.skills.length > 0) && (
        <section className="mb-8">
          <SectionLabel spaced>Skills</SectionLabel>
          <ul className="space-y-2 text-sm">
            {kit.skillsInKit.map((skill) => (
              <li key={`bundled:${skill.name}`}>
                {skill.name}{" "}
                <Badge variant="kit" size="sm">
                  Starter Kit
                </Badge>
                {skill.description ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {skill.description}
                  </span>
                ) : null}
              </li>
            ))}
            {kit.skills.map((skill) => (
              <li key={`external:${skill.source}`}>
                {skill.name}{" "}
                <Badge variant="muted" size="sm">
                  installed at create
                </Badge>
                <span className="text-muted-foreground"> — {skill.source}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Skills marked <em>in the kit</em> arrive with the definition the
            agent clones and are discovered as files — the platform installs
            nothing for them.
          </p>
        </section>
      )}

      {kit && kit.parameters.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Onboarding will ask you for</SectionLabel>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {kit.parameters.map((p) => (
              <li key={p.name}>
                {p.name}
                <span className="text-muted-foreground">
                  {" "}
                  ({p.required ? "required" : "optional"})
                  {p.note ? ` — ${p.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!kit && (
        <ConnectedKnowledgeBasesSetup
          connectionIds={form.connectionIds}
          onToggle={toggleConnection}
        />
      )}
    </SetupPageShell>
  );
}
