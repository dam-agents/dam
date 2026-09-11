import { CheckmarkFilled, CircleDash } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";
import { useCallback, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
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
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useApplyStarterKit } from "../api/mutations.js";
import { useStarterKit } from "../api/queries.js";
import {
  buildStarterKitApplyInput,
  connectableTemplates,
  describeTemplates,
  isProviderRequirement,
  isStarterKitSetupComplete,
  providerPolicyForKit,
  requirementStatuses,
  type StarterKitSetupDraft,
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
  const [connectTemplateId, setConnectTemplateId] = useState<string | null>(
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
  };
  const owned = connections.data ?? [];
  const statuses = requirementStatuses(kit, draft, owned);
  const canApply =
    isStarterKitSetupComplete(kit, draft, owned) &&
    !pinMissing &&
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

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={providerPolicyForKit(kit, setupProviderPolicy("starter-kit"))}
      />

      {statuses.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>What this kit needs</SectionLabel>
          <ul className="space-y-2 text-sm">
            {statuses.map(({ requirement, satisfied }) => (
              <li
                key={requirement.templates.join("|")}
                className="flex items-start gap-2"
              >
                {satisfied ? (
                  <CheckmarkFilled className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <CircleDash className="mt-0.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div>
                    {describeTemplates(requirement.templates, templateById)}{" "}
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
                      {connectableTemplates(requirement, templateById).map(
                        (t) => (
                          <Button
                            key={t.id}
                            size="sm"
                            variant="outline"
                            onClick={() => setConnectTemplateId(t.id)}
                            data-testid={`starter-kit-connect-${t.id}`}
                          >
                            Connect {t.name}
                          </Button>
                        ),
                      )}
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
      {connectTemplateId && (
        <ConnectionCatalogModal
          initialTemplateId={connectTemplateId}
          onClose={() => setConnectTemplateId(null)}
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
          <ul className="space-y-1 text-sm">
            {kit.schedules.map((s) => (
              <li key={s.name} className="flex items-baseline gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  {"cron" in s ? s.cron : `${s.rrule} (${s.timezone})`}
                  {s.enabled ? "" : " — created disabled"}
                </span>
              </li>
            ))}
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
