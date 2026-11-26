import { useQueries } from "@tanstack/react-query";
import {
  providerTypeForTemplateId,
  type SpendBreakdown,
  type SpendLimitView,
  type SpendUnit,
} from "api-server-api";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { ProviderPresetType } from "../../../types.js";
import {
  NEUTRAL_FILL,
  NEUTRAL_LIGHT_FILL,
} from "../../budgets/lib/pool-colors.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { useOwnerSpendStatus } from "../api/queries.js";
import { agentLimitOf } from "../lib/agent-limit.js";
import { agentLabel, agentNameOf } from "../lib/breakdown-sources.js";
import {
  allAgentsOn,
  leftToday,
  limitShareLabel,
  NO_SPEND_IN_PERIOD,
  paidWithPlanUse,
  percentOfLimit,
  PROVIDER_LIMITS_LINK,
} from "../lib/copy.js";
import { bareSpend, meterAmount } from "../lib/format.js";
import { connectionDisplayName } from "../lib/level-labels.js";
import { amountsBy, VISIBLE_MICROS } from "../lib/measured-spend.js";
import { LimitBar } from "./limit-bar.js";
import { LimitAmounts } from "./limit-row.js";
import { SpendAgentAvatar } from "./spend-agent-avatar.js";

const TOP_SPENDERS = 3;
const LIMITS_REFRESH_MS = 15_000;
const ROW_HIDDEN = { opacity: 0, y: 16 };
const BAR_FILL =
  "rounded-full motion-safe:transition-[width] motion-safe:duration-500";

interface Spender {
  agentId: string;
  agentName: string | null;
  paidMicros: number;
  planMicros: number;
}

function topSpenders(
  byAgent: SpendBreakdown["byAgent"],
  showPlanUse: boolean,
): Spender[] {
  const size = (spender: Spender) =>
    spender.paidMicros + (showPlanUse ? spender.planMicros : 0);
  const nameOf = agentNameOf(byAgent);
  return [...amountsBy(byAgent, (row) => row.agentId)]
    .map(([agentId, amounts]) => ({
      agentId,
      agentName: nameOf(agentId),
      paidMicros: amounts.usd,
      planMicros: amounts.usd_list,
    }))
    .filter((spender) => size(spender) >= VISIBLE_MICROS)
    .sort((a, b) => size(b) - size(a))
    .slice(0, TOP_SPENDERS);
}

interface Props {
  byAgent: SpendBreakdown["byAgent"];
  showPlanUse: boolean;
  measured: boolean;
  withLimits: boolean;
}

export function TopSpenders({
  byAgent,
  showPlanUse,
  measured,
  withLimits,
}: Props) {
  const spenders = topSpenders(byAgent, showPlanUse);
  const agentLimits = useAgentLimits(
    withLimits ? spenders.map((spender) => spender.agentId) : [],
  );
  const providers = useProviderLimits();
  const shownProviders = withLimits ? providers : [];
  const scale = Math.max(
    0,
    ...spenders.map(
      (spender) => spender.paidMicros + (showPlanUse ? spender.planMicros : 0),
    ),
    ...[...agentLimits.values()].map((limit) => limit.effectiveMicros),
  );
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {spenders.map((spender) => (
          <motion.div
            key={spender.agentId}
            layout="position"
            initial={ROW_HIDDEN}
            animate={{ opacity: 1, y: 0 }}
            exit={ROW_HIDDEN}
          >
            <SpenderRow
              spender={spender}
              showPlanUse={showPlanUse}
              limitMicros={
                agentLimits.get(spender.agentId)?.effectiveMicros ?? null
              }
              scale={scale}
            />
          </motion.div>
        ))}
        {spenders.length === 0 && measured && (
          <motion.p
            key="empty"
            layout="position"
            initial={ROW_HIDDEN}
            animate={{ opacity: 1, y: 0 }}
            exit={ROW_HIDDEN}
            className="text-sm text-muted-foreground"
          >
            {NO_SPEND_IN_PERIOD}
          </motion.p>
        )}
      </AnimatePresence>
      {shownProviders.map((provider) => (
        <ProviderLimitBox key={provider.limitId} provider={provider} />
      ))}
    </div>
  );
}

function useAgentLimits(
  agentIds: readonly string[],
): ReadonlyMap<string, SpendLimitView> {
  const results = useQueries({
    queries: agentIds.map((agentId) => ({
      ...trpc.spend.status.queryOptions({ agentId }),
      refetchInterval: LIMITS_REFRESH_MS,
    })),
  });
  const limits = new Map<string, SpendLimitView>();
  agentIds.forEach((agentId, index) => {
    const status = results[index]?.data;
    const limit = status && agentLimitOf(status, agentId);
    if (limit) limits.set(agentId, limit);
  });
  return limits;
}

interface ProviderLimit {
  limitId: string;
  name: string;
  type: ProviderPresetType | null;
  unit: SpendUnit;
  spentMicros: number;
  effectiveMicros: number;
  leftMicros: number;
}

/** UNIT_BOUNDARY_DESCRIPTION: the owner's provider limits for all agents, as Home's spend card shows them under the agents on Today, each on its own scale; a provider with no such limit shows nothing. */
export function useProviderLimits(): ProviderLimit[] {
  const { data: status } = useOwnerSpendStatus();
  const { data: connections } = useAppConnections();
  return (status?.limits ?? []).flatMap((limit) => {
    if (limit.scope.kind !== "owner-connection") return [];
    const { connectionId } = limit.scope;
    const found = connections?.find((c) => c.id === connectionId);
    const templateId = found?.templateId ?? "";
    return [
      {
        limitId: limit.id,
        name: connectionDisplayName(found?.name ?? connectionId, templateId),
        type: templateId ? providerTypeForTemplateId(templateId) : null,
        unit: limit.unit,
        spentMicros: limit.spentMicros,
        effectiveMicros: limit.effectiveMicros,
        leftMicros: limit.leftMicros,
      },
    ];
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: one provider limit for all agents on Home, in a box of its own under the agents: its name and share used, what is left today, a link to the providers, and a bar of the limit's own. */
function ProviderLimitBox({ provider }: { provider: ProviderLimit }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const name = allAgentsOn(provider.name);
  const pct = percentOfLimit(provider.spentMicros, provider.effectiveMicros);
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        {provider.type && <CardIcon provider={provider.type} size="tile-xs" />}
        <span className="min-w-0 truncate text-foreground">
          {`${name}: `}
          <b className="font-semibold tabular-nums">{`${String(pct)}%`}</b>
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums whitespace-nowrap">
          {leftToday(meterAmount(provider.leftMicros, provider.unit))}
        </span>
        <Button
          variant="link"
          size="inline"
          className="shrink-0"
          onClick={() => navigateToSettings("providers")}
        >
          {PROVIDER_LIMITS_LINK}
        </Button>
      </div>
      <LimitBar pct={pct} label={limitShareLabel(name, pct)} percent={false} />
    </div>
  );
}

function SpenderRow({
  spender,
  showPlanUse,
  limitMicros,
  scale,
}: {
  spender: Spender;
  showPlanUse: boolean;
  limitMicros: number | null;
  scale: number;
}) {
  const name = agentLabel(spender.agentName);
  const withPlan = showPlanUse && spender.planMicros >= VISIBLE_MICROS;
  return (
    <ScaledRow
      icon={<SpendAgentAvatar agentId={spender.agentId} name={name} />}
      name={name}
      spentMicros={spender.paidMicros}
      planMicros={withPlan ? spender.planMicros : 0}
      limitMicros={limitMicros}
      scale={scale}
      amount={
        limitMicros !== null ? (
          <LimitAmounts
            spentMicros={spender.paidMicros}
            amountMicros={limitMicros}
            unit="usd"
          />
        ) : (
          <span className="min-w-18 shrink-0 text-right text-sm text-foreground tabular-nums whitespace-nowrap">
            {withPlan
              ? paidWithPlanUse(spender.paidMicros, spender.planMicros)
              : bareSpend(spender.paidMicros, "usd")}
          </span>
        )
      }
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one row of Home's spend card: its icon and name,
 * a bar on the card's one scale, and the amount. A limit shows as a light
 * track of its length, the spend as a black fill over it, so every row
 * compares with every other at a glance.
 */
function ScaledRow({
  icon,
  name,
  spentMicros,
  planMicros,
  limitMicros,
  scale,
  amount,
}: {
  icon: ReactNode;
  name: string;
  spentMicros: number;
  planMicros: number;
  limitMicros: number | null;
  scale: number;
  amount: ReactNode;
}) {
  const pct = (micros: number) =>
    scale > 0 ? Math.min(100, (micros / scale) * 100) : 0;
  const label =
    limitMicros !== null
      ? limitShareLabel(name, percentOfLimit(spentMicros, limitMicros))
      : `${name}: ${bareSpend(spentMicros + planMicros, "usd")}`;
  return (
    <div className="flex h-9 items-center gap-2.5">
      <span className="flex w-[34%] min-w-0 shrink-0 items-center gap-1.5 text-sm text-foreground">
        {icon}
        <span className="truncate" title={name}>
          {name}
        </span>
      </span>
      <div
        role="img"
        aria-label={label}
        className="relative h-3 min-w-0 flex-1"
      >
        {limitMicros !== null && (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/10"
            style={{ width: `${String(pct(limitMicros))}%` }}
          />
        )}
        <span
          className={cn("absolute inset-y-0 left-0 flex", BAR_FILL)}
          style={{ width: `${String(pct(spentMicros + planMicros))}%` }}
        >
          <span
            className={cn("h-full", NEUTRAL_FILL, BAR_FILL)}
            style={{ flexGrow: spentMicros, minWidth: spentMicros > 0 ? 8 : 0 }}
          />
          {planMicros > 0 && (
            <span
              className={cn("h-full", NEUTRAL_LIGHT_FILL, BAR_FILL)}
              style={{ flexGrow: planMicros }}
            />
          )}
        </span>
      </div>
      {amount}
    </div>
  );
}

export function SpenderRowsSizer({ providers = 0 }: { providers?: number }) {
  return (
    <div aria-hidden="true" className="invisible flex flex-col gap-3">
      {Array.from({ length: TOP_SPENDERS }, (_, i) => (
        <div key={i} className="h-9" />
      ))}
      {Array.from({ length: providers }, (_, i) => (
        <div key={i} className="h-[62px]" />
      ))}
    </div>
  );
}

export function TopSpendersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: TOP_SPENDERS }, (_, i) => (
        <div key={i}>
          <p className="mb-1 text-sm">
            <TextSkeleton width={i % 2 === 0 ? "40%" : "30%"} />
          </p>
          <div className="h-3 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
