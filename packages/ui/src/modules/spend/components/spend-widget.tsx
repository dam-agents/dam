import type { SpendDailyRow } from "api-server-api";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { NEUTRAL_FILL } from "../../budgets/lib/pool-colors.js";
import { useOwnerSpendStatus, useSpendDaily } from "../api/queries.js";
import {
  apiSpendHelp,
  DELETED_AGENT_NAME,
  OWN_LIMIT_NAME,
} from "../lib/copy.js";
import { microsToUsd } from "../lib/format.js";
import {
  SPEND_PERIODS,
  spendDays,
  type SpendPeriod,
} from "../lib/spend-period.js";
import { AnimatedUsd } from "./animated-usd.js";
import { HelpTip } from "./help-tip.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

const TOP_SPENDERS = 3;
const ROUNDS_TO_A_VISIBLE_CENT_USD = 0.005;
const REFRESH_MS = 30_000;
const ROW_HIDDEN = { opacity: 0, y: 16 };

interface Spender {
  agentId: string;
  agentName: string;
  avatar: string | null | undefined;
  deleted: boolean;
  costUsd: number;
}

function usdSpend(
  rows: readonly SpendDailyRow[],
  agents: readonly AgentView[],
): { total: number; spenders: Spender[] } {
  const byAgent = new Map<string, number>();
  for (const row of rows) {
    if (row.unit !== "usd") continue;
    byAgent.set(row.agentId, (byAgent.get(row.agentId) ?? 0) + row.costMicros);
  }
  const spenders = [...byAgent].map(([agentId, micros]) => {
    const agent = agents.find((a) => a.id === agentId);
    return {
      agentId,
      agentName: agent?.name ?? DELETED_AGENT_NAME,
      avatar: agent?.avatar,
      deleted: !agent,
      costUsd: microsToUsd(micros),
    };
  });
  return {
    total: spenders.reduce((sum, spender) => sum + spender.costUsd, 0),
    spenders: spenders
      .filter((spender) => spender.costUsd >= ROUNDS_TO_A_VISIBLE_CENT_USD)
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, TOP_SPENDERS),
  };
}

export function SpendWidget({
  showOwnLimit = true,
}: {
  showOwnLimit?: boolean;
}) {
  const [period, setPeriod] = useState<SpendPeriod>("1m");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const agents = useAgentsList();
  const { from, to } = useMemo(
    () => spendDays(period, new Date(now)),
    [period, now],
  );
  const query = useSpendDaily({ from, to });
  const { data: status } = useOwnerSpendStatus();
  const ownLimit = status?.limits.find((view) => view.scope.kind === "owner");
  const data = query.data;
  const { total, spenders } = usdSpend(data ?? [], agents);
  const top = spenders[0]?.costUsd ?? 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col rounded-lg border border-border bg-card p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground">
            API spend
            <HelpTip content={apiSpendHelp()} />
            {query.isFetching && (
              <Spinner
                size={12}
                label="Loading spend"
                className="text-muted-foreground"
              />
            )}
          </p>
          <div className="-my-1.5 flex shrink-0 gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5">
            {SPEND_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                aria-pressed={option === period}
                className={cn(
                  "rounded-md px-1.5 py-1 text-sm transition-colors",
                  option === period
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-5 text-2xl font-semibold tabular-nums text-foreground">
          {data ? (
            <AnimatedUsd value={total} />
          ) : query.isError ? (
            "—"
          ) : (
            <TextSkeleton width={96} />
          )}
        </p>

        {showOwnLimit && ownLimit && (
          <div className="mb-5">
            <SpendLimitMeter
              label={OWN_LIMIT_NAME}
              showLabel
              unit="usd"
              spentMicros={ownLimit.spentMicros}
              limitMicros={ownLimit.effectiveMicros}
              state={ownLimit.state}
              extensions={ownLimit.extensions}
            />
          </div>
        )}

        <div className={cn("relative", showOwnLimit && "min-h-[132px]")}>
          {data ? (
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
                    <div className="mb-1 flex items-center justify-between">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                        <AgentAvatar
                          name={spender.agentName}
                          avatar={spender.avatar}
                          mood={spender.deleted ? "disabled" : "awake"}
                          size={16}
                        />
                        <span className="truncate">{spender.agentName}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-sm text-muted-foreground tabular-nums">
                        <AnimatedUsd value={spender.costUsd} />
                      </span>
                    </div>
                    <motion.div
                      className={cn("h-3 rounded-full", NEUTRAL_FILL)}
                      initial={{ width: "0%" }}
                      animate={{
                        width:
                          top > 0 ? `${(spender.costUsd / top) * 100}%` : "0%",
                      }}
                    />
                  </motion.div>
                ))}
                {spenders.length === 0 && (
                  <motion.p
                    key="empty"
                    layout="position"
                    initial={ROW_HIDDEN}
                    animate={{ opacity: 1, y: 0 }}
                    exit={ROW_HIDDEN}
                    className="text-sm text-muted-foreground"
                  >
                    No API spend in this period.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          ) : query.isError ? (
            <p className="text-sm text-muted-foreground">
              Spend could not be loaded.
            </p>
          ) : (
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
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
