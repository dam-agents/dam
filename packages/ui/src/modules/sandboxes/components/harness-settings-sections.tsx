import { skipToken, useQuery } from "@tanstack/react-query";
import type { HarnessCapability } from "agent-runtime-api";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { agentTrpc, agentTrpcHttp } from "../../agents/agent-trpc.js";
import { useApplyHarnessConfig } from "../../agents/api/harness-config.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useHarnessCatalog } from "../../sessions/api/session-pair.js";
import { OptionPicker } from "../../sessions/components/model-settings-panel.js";
import { OptionField } from "../../sessions/components/option-field.js";

type CatalogOption = NonNullable<
  HarnessCapability["harnessConfigCatalog"]
>["options"][number];

const harnessWide = (harness: HarnessCapability) => (o: CatalogOption) =>
  o.category !== "model" &&
  (!harness.sessionSettings?.includes(o.id) ||
    o.category === "mode" ||
    o.choices.some((c) => c.value === o.default && c.needsApproval));

const harnessCurrentKey = (agentId: string, harness: string) =>
  ["harness-config-current", agentId, harness] as const;

function useHarnessValues(agentId: string, harness: string) {
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  const live = useQuery({
    queryKey: harnessCurrentKey(agentId, harness),
    queryFn: operable
      ? () =>
          (compat
            ? agentTrpcHttp(agentId)
            : agentTrpc(agentId)
          ).harnessConfig.current.query({ harness })
      : skipToken,
    retry: false,
  });
  const snapshot = useQuery({
    ...trpc.harnessConfig.snapshot.queryOptions({ agentId, harness }),
    retry: false,
  });
  return {
    values:
      (operable ? live.data : undefined) ?? snapshot.data?.snapshot ?? null,
    loading: live.isLoading || snapshot.isLoading,
    liveFailed: operable && live.isError,
    refetch: operable ? live.refetch : snapshot.refetch,
  };
}

export function HarnessSettingsSections({
  agentId,
  harnesses,
}: {
  agentId: string;
  harnesses: readonly HarnessCapability[];
}) {
  const { data: catalog } = useHarnessCatalog();
  const configurable = harnesses.filter(
    (h) =>
      h.harnessConfig && h.harnessConfigCatalog?.options.some(harnessWide(h)),
  );
  if (configurable.length === 0) return null;
  return (
    <section className="mb-8" data-testid="harness-settings">
      <SectionLabel spaced>Harness settings</SectionLabel>
      <Callout>
        {configurable.map((h) => (
          <HarnessSettings
            key={h.name}
            agentId={agentId}
            harness={h}
            displayName={
              catalog?.harnesses.find((c) => c.name === h.name)?.displayName ??
              h.name
            }
          />
        ))}
        <p className="pt-3 text-2xs leading-snug text-muted-foreground">
          Settings each harness keeps for all its sessions. The model, effort
          and other session settings are chosen in each session, or in the
          defaults on the Providers page.
        </p>
      </Callout>
    </section>
  );
}

function HarnessSettings({
  agentId,
  harness,
  displayName,
}: {
  agentId: string;
  harness: HarnessCapability;
  displayName: string;
}) {
  const { values, loading, liveFailed, refetch } = useHarnessValues(
    agentId,
    harness.name,
  );
  const apply = useApplyHarnessConfig();
  const groups =
    harness.harnessConfigCatalog?.options.filter(harnessWide(harness)) ?? [];
  const valueOf = (id: string): string | null =>
    id === "mode"
      ? (values?.mode ?? null)
      : (values?.configOptions[id] ?? null);
  const choose = (id: string, value: string | null) =>
    apply.mutate(
      {
        agentId,
        harness: harness.name,
        ...(value === null
          ? { unset: [id] }
          : id === "mode"
            ? { mode: value }
            : { configOptions: { [id]: value } }),
      },
      {
        onSettled: () =>
          queryClient.invalidateQueries({
            queryKey: harnessCurrentKey(agentId, harness.name),
          }),
      },
    );

  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-sm font-medium">{displayName}</h3>
      {liveFailed && values && (
        <p className="mb-2 text-xs text-muted-foreground">
          Live settings unavailable. Showing the last recorded values.
        </p>
      )}
      {!values && (
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading settings…"
            : "Settings unavailable. Start or upgrade the agent to read its settings."}
          {!loading && (
            <button
              type="button"
              onClick={() => void refetch()}
              className="ml-1 underline"
            >
              Retry
            </button>
          )}
        </p>
      )}
      {values &&
        groups.map((group) => (
          <OptionField key={group.id} title={group.name}>
            <OptionPicker
              title={`${displayName} ${group.name}`}
              choices={group.choices.map((c) => ({
                id: c.value,
                name: c.name,
                description: c.description,
              }))}
              value={valueOf(group.id) ?? group.default ?? null}
              clearable={false}
              onSelect={(id) => choose(group.id, id)}
            />
          </OptionField>
        ))}
    </div>
  );
}
