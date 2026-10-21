import { useQuery } from "@tanstack/react-query";
import type { ProviderOutage, ProviderStatusView } from "api-server-api";

import { trpc } from "../../../trpc.js";

const POLL_MS = 60_000;

export type ProviderCondition =
  | { kind: "no-outage" }
  | { kind: "degraded"; outage: ProviderOutage }
  | { kind: "dam-side"; since: string };

const statusQuery = () => ({
  ...trpc.providerStatus.list.queryOptions(),
  refetchInterval: POLL_MS,
});

export function useProviderStatus() {
  return useQuery(statusQuery());
}

function conditionOf(
  view: ProviderStatusView,
  templateId: string | null,
): ProviderCondition {
  if (view.damSide) return { kind: "dam-side", since: view.damSide.since };
  const outage = view.outages.find((o) => o.templateId === templateId);
  return outage ? { kind: "degraded", outage } : { kind: "no-outage" };
}

export function useOutageFor(templateId: string | null): ProviderCondition {
  const { data } = useQuery({
    ...statusQuery(),
    select: (view) => conditionOf(view, templateId),
  });
  return data ?? { kind: "no-outage" };
}
