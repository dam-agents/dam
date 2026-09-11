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
import {
  buildStarterKitApplyInput,
  type ConnectTarget,
  connectTargets,
  describeAccepts,
  isProviderRequirement,
  isStarterKitSetupComplete,
  kitScheduleCadence,
  ownedMatches,
  preselectedGrants,
  providerPolicyForKit,
  requirementStatuses,
  type StarterKitSetupDraft,
  toggleSkipped,
} from "../lib/setup.js";

export function StarterKitSetupView() {
  const kitId = useStore((s) => s.starterKitId);
  const kit = useStarterKit(kitId);
  if (kit.data === undefined) {
    return <ListSkeleton rows={3} rowHeight={80} />;
  }
  return <StarterKitSetupForm kit={kit.data} />;
}

function StarterKitSetupForm({ kit }: { kit: StarterKitView }) {
  const returnPath = routeToPath({ view: "starter-kit-new", kit: kit.id });
  const { form, update, toggleConnection, reset } = useSetupForm(
    "starter-kit",
    { name: kit.id },
    returnPath,
  );
  const apply = useApplyStarterKit();
  const selectAgent = useStore((s) => s.selectAgent);
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

  const pinnedTemplate = kit.template
    ? (templates.data?.find((t) => t.id === kit.template) ?? null)
    : null;
  const pinMissing =
    kit.template !== undefined &&
    templates.data !== undefined &&
    pinnedTemplate === null;

  const draft: StarterKitSetupDraft = {
    name: form.name,
    templateId: form.templateId,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
    slackChannelId: form.slackChannelId,
    skippedSchedules: form.skippedSchedules,
  };
  const owned = connections.data ?? [];
  const statuses = requirementStatuses(kit, draft, owned);
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || connections.data === undefined) return;
    preselected.current = true;
    for (const id of preselectedGrants(
      kit,
      connections.data,
      form.connectionIds,
    ))
      toggleConnection(id, true);
  }, [kit, connections.data, form.connectionIds, toggleConnection]);
  const selectedTemplate = kit.template
    ? pinnedTemplate
    : (templates.data?.find((t) => t.id === form.templateId) ?? null);
  const providerPolicy = narrowPolicyToTemplate(
    providerPolicyForKit(kit, setupProviderPolicy("starter-kit")),
    selectedTemplate,
  );
  const noCompatibleProvider = (providerPolicy.allow?.length ?? 1) === 0;
  const canApply =
    isStarterKitSetupComplete(kit, draft, owned) &&
    !pinMissing &&
    !noCompatibleProvider &&
    !apply.isPending;

  const create = async () => {
    if (!canApply) return;
    try {
      const result = await apply.mutateAsync(
        buildStarterKitApplyInput(kit, draft, owned),
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

  const slackChannel = kit.channels.find((c) => c.type === "slack") ?? null;

  return (
    <SetupPageShell
      title={`Set up: ${kit.name}`}
      subtitle={kit.description}
      footer={
        <Button onClick={() => void create()} disabled={!canApply}>
          {apply.isPending ? "Creating…" : "Create agent from this kit"}
        </Button>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <section className="mb-8">
        <SectionLabel spaced>Harness</SectionLabel>
        {kit.template ? (
          <Callout tone={pinMissing ? "warning" : "default"}>
            {pinMissing
              ? `This kit runs on the "${kit.template}" image, which is not installed here.`
              : `This kit runs on the ${pinnedTemplate?.name ?? kit.template} image. The harness is fixed by the kit.`}
          </Callout>
        ) : (
          <HarnessGrid
            harnesses={catalogue.harnesses}
            loading={catalogue.isLoading}
            error={catalogue.isError}
            onRetry={catalogue.refetch}
            templateId={form.templateId}
            onPick={(templateId) => update({ templateId })}
          />
        )}
      </section>

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
          <SectionLabel spaced>What this kit needs</SectionLabel>
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
                      {ownedMatches(requirement, owned).map((c) => (
                        <Button
                          key={`use-${c.id}`}
                          size="sm"
                          variant="secondary"
                          onClick={() => toggleConnection(c.id, true)}
                          data-testid={`starter-kit-use-${c.id}`}
                        >
                          Use {c.name ?? c.id}
                        </Button>
                      ))}
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

      {slackChannel && (
        <section className="mb-8">
          <FormField
            label="Slack channel (optional)"
            disableInset
            hint={
              slackChannel.note
                ? `${slackChannel.note} The ID is in the channel's details in Slack and starts with C; the bot must be a member.`
                : "From the channel's details in Slack — starts with C. The bot must be a member of the channel."
            }
          >
            <Input
              className="h-10"
              value={form.slackChannelId}
              onChange={(e) => update({ slackChannelId: e.target.value })}
              placeholder="C0…"
              data-testid="starter-kit-slack-channel-id"
            />
          </FormField>
        </section>
      )}

      {kit.schedules.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Schedules this kit creates</SectionLabel>
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
