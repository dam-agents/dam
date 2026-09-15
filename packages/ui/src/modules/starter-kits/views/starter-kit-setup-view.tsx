import { CheckmarkFilled, CircleDash, Close, Undo } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { HarnessGrid } from "../../sandboxes/components/setup/harness-grid.js";
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
import { useTemplates } from "../../templates/api/queries.js";
import { useApplyStarterKit } from "../api/mutations.js";
import { useStarterKit } from "../api/queries.js";
import { kitBadges } from "../lib/catalog-cards.js";
import { kitIcon } from "../lib/kit-icon.js";
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
  kitScheduleCadence,
  ownAgentLine,
  ownedMatches,
  preselectedGrants,
  providerPolicyForKit,
  requirementStatuses,
  type StarterKitSetupDraft,
  toggleSkipped,
} from "../lib/setup.js";

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
  return <StarterKitSetupForm kit={kit.data} />;
}

function StarterKitSetupForm({ kit }: { kit: StarterKitView }) {
  const returnPath = routeToPath({
    view: "starter-kit-new",
    catalog: kit.catalog,
    kit: kit.id,
  });
  const { form, update, toggleConnection, reset } = useSetupForm(
    "starter-kit",
    { name: kit.id },
    returnPath,
    `${kit.catalog}/${kit.id}`,
  );
  const apply = useApplyStarterKit();
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
    allowNone: false,
    onTemplateIdChange,
  });

  const bringsImage = kit.image !== undefined;
  const resourcesLine = kitResourcesLine(kit);
  const harnesses = allowedHarnesses(kit, catalogue.harnesses);
  const noHarnessInstalled =
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
  };
  const owned = connections.data ?? [];
  const statuses = requirementStatuses(kit, draft, owned, templateById);
  const preselected = useRef(false);
  useEffect(() => {
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
  const providerSource = bringsImage
    ? kit.image
    : (templates.data?.find((t) => t.id === form.templateId) ?? null);
  const providerPolicy = narrowPolicyToTemplate(
    providerPolicyForKit(kit, setupProviderPolicy("starter-kit")),
    providerSource,
  );
  const noCompatibleProvider = (providerPolicy.allow?.length ?? 1) === 0;
  const canApply =
    isStarterKitSetupComplete(kit, draft, owned, templateById) &&
    harnessAllowed &&
    !noCompatibleProvider &&
    !apply.isPending;

  const create = async () => {
    if (!canApply) return;
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

  const KitIcon = kitIcon(kit);

  return (
    <SetupPageShell
      title="Create an agent"
      subtitle="Configure your agent with a name, harness, and connections."
      footer={
        <Button onClick={() => void create()} disabled={!canApply}>
          {apply.isPending ? "Creating…" : "Create agent from this kit"}
        </Button>
      }
    >
      <section className="mb-8">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-accent/30 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
            <KitIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{kit.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {kitBadges(kit, connectionTemplates.data ?? [], templateById).map(
                (b) => (
                  <Badge key={b.key} variant="muted" size="sm">
                    {b.label}
                  </Badge>
                ),
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToStarterKit(kit.catalog, kit.id)}
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
        </div>
      </section>

      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <section className="mb-8">
        <SectionLabel spaced>Harness</SectionLabel>
        {bringsImage ? (
          <Callout tone="default">
            <div>{ownAgentLine(kit)}. The harness is fixed by the kit.</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {kit.image?.ref}
            </div>
          </Callout>
        ) : noHarnessInstalled ? (
          <Callout tone="warning">
            This kit runs on {harnessesLine(kit).replace(/^An agent on /, "")},
            and none of those is installed here.
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

      {resourcesLine && (
        <section className="mb-8">
          <SectionLabel spaced>Size</SectionLabel>
          <Callout tone="default">
            <div>{resourcesLine}</div>
            {kit.resources?.note && (
              <div className="mt-1 text-muted-foreground">
                {kit.resources.note}
              </div>
            )}
            <div className="mt-1 text-muted-foreground">
              The kit sizes the agent instead of the install default. CPU and
              memory count against your compute ceiling and can be changed on
              the agent later; disk is fixed at create.
            </div>
          </Callout>
        </section>
      )}

      {noCompatibleProvider ? (
        <section className="mb-8">
          <SectionLabel spaced>Provider</SectionLabel>
          <Callout tone="warning">
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

      {statuses.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Connections</SectionLabel>
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
                    <Badge variant="template" size="sm">
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

      {kit.channels.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Channels (optional)</SectionLabel>
          <ul className="flex flex-col gap-2">
            {kit.channels.map((channel) => (
              <li
                key={channel.type}
                className="rounded-lg border border-border px-4 py-3"
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
                      <Badge variant="template" size="sm">
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

      {kit.schedules.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Schedules</SectionLabel>
          <p className="mb-3 text-sm text-muted-foreground">
            Created with the author's defaults. Skip any you do not want; a
            disabled one is created switched off and is one toggle away under
            Schedules.
          </p>
          <ul className="divide-y divide-border rounded-md border">
            {kit.schedules.map((s) => {
              const skipped = form.skippedSchedules.includes(s.name);
              return (
                <li
                  key={s.name}
                  className="flex items-start gap-3 px-3 py-2.5 text-sm"
                  data-testid={`starter-kit-schedule-${s.name}`}
                >
                  <div
                    className={`min-w-0 flex-1 ${skipped ? "text-muted-foreground line-through" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant="template" size="sm">
                        Starter Kit
                      </Badge>
                      {!skipped && (
                        <Badge
                          variant={s.enabled ? "success" : "muted"}
                          size="sm"
                        >
                          {s.enabled ? "enabled" : "created disabled"}
                        </Badge>
                      )}
                      {skipped && (
                        <Badge variant="muted" size="sm">
                          skipped
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {kitScheduleCadence(s)}
                    </div>
                    <div className="text-muted-foreground">{s.task}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={
                      skipped ? `Add back ${s.name}` : `Skip ${s.name}`
                    }
                    title={skipped ? "Add back" : "Skip this schedule"}
                    onClick={() =>
                      update({
                        skippedSchedules: toggleSkipped(
                          form.skippedSchedules,
                          s.name,
                        ),
                      })
                    }
                  >
                    {skipped ? <Undo size={16} /> : <Close size={16} />}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(kit.skillsInKit.length > 0 || kit.skills.length > 0) && (
        <section className="mb-8">
          <SectionLabel spaced>Skills</SectionLabel>
          <ul className="space-y-2 text-sm">
            {kit.skillsInKit.map((skill) => (
              <li key={`bundled:${skill.name}`}>
                {skill.name}{" "}
                <Badge variant="template" size="sm">
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

      {kit.parameters.length > 0 && (
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
    </SetupPageShell>
  );
}
