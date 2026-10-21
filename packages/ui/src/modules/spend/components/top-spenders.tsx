import type { SpendBreakdown } from "api-server-api";
import { AnimatePresence, motion } from "motion/react";

import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import {
  NEUTRAL_FILL,
  NEUTRAL_LIGHT_FILL,
} from "../../budgets/lib/pool-colors.js";
import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import { agentLabel, agentNameOf } from "../lib/breakdown-sources.js";
import { NO_SPEND_IN_PERIOD, paidWithPlanUse } from "../lib/copy.js";
import { bareSpend } from "../lib/format.js";
import { amountsBy, VISIBLE_MICROS } from "../lib/measured-spend.js";
import { SpendAgentAvatar } from "./spend-agent-avatar.js";

const TOP_SPENDERS = 3;
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
}

export function TopSpenders({ byAgent, showPlanUse, measured }: Props) {
  const spenders = topSpenders(byAgent, showPlanUse);
  const top = spenders[0];
  const topMicros = top
    ? top.paidMicros + (showPlanUse ? top.planMicros : 0)
    : 0;
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
              topMicros={topMicros}
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
    </div>
  );
}

function SpenderRow({
  spender,
  showPlanUse,
  topMicros,
}: {
  spender: Spender;
  showPlanUse: boolean;
  topMicros: number;
}) {
  const name = agentLabel(spender.agentName);
  const withPlan = showPlanUse && spender.planMicros >= VISIBLE_MICROS;
  const pct = (micros: number) =>
    topMicros > 0 ? (micros / topMicros) * 100 : 0;
  const shownMicros = spender.paidMicros + (withPlan ? spender.planMicros : 0);
  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <SpendAgentAvatar agentId={spender.agentId} name={name} />
          <span className="truncate">{name}</span>
        </span>
        <span className="ml-2 shrink-0 text-sm text-muted-foreground tabular-nums">
          {withPlan
            ? paidWithPlanUse(spender.paidMicros, spender.planMicros)
            : bareSpend(spender.paidMicros, "usd")}
        </span>
      </div>
      <SpendBarTrack
        pct={pct(spender.paidMicros)}
        extraPct={withPlan ? pct(spender.planMicros) : 0}
        label={`${Math.round(pct(shownMicros))}% of the top agent`}
        className="h-3 rounded-full"
        fillClassName={cn(NEUTRAL_FILL, BAR_FILL)}
        extraFillClassName={cn(NEUTRAL_LIGHT_FILL, BAR_FILL)}
      />
    </>
  );
}

export function SpenderRowsSizer() {
  return (
    <div aria-hidden="true" className="invisible flex flex-col gap-3">
      {Array.from({ length: TOP_SPENDERS }, (_, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center text-sm">
            <AgentAvatar name="" size={16} />
            <span>&nbsp;</span>
          </div>
          <div className="h-3" />
        </div>
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
