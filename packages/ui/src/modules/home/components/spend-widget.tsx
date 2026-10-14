import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { NEUTRAL_FILL } from "../../budgets/lib/pool-colors.js";
import { useSpendBreakdown } from "../../metrics/api/queries.js";
import { totalCostUsd } from "../../metrics/lib/totals.js";
import { cachedSpend } from "../api/queries.js";
import {
  SPEND_PERIODS,
  type SpendPeriod,
  spendRange,
} from "../lib/spend-period.js";
import { AnimatedUsd } from "./animated-usd.js";

const TOP_SPENDERS = 3;
const ROUNDS_TO_A_VISIBLE_CENT_USD = 0.005;
const REFRESH_MS = 30_000;
const ROW_HIDDEN = { opacity: 0, y: 16 };

export function SpendWidget() {
  const [period, setPeriod] = useState<SpendPeriod>("1m");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const agents = useAgentsList();
  const queryClient = useQueryClient();
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const { from, to } = useMemo(
    () => spendRange(period, new Date(now)),
    [period, now],
  );
  const homeSpend = `${period} ${timeZone}`;
  const query = useSpendBreakdown(from, to, timeZone, undefined, { homeSpend });
  const cached = cachedSpend(queryClient, homeSpend);
  const data = query.isPlaceholderData
    ? (cached ?? query.data)
    : (query.data ?? cached);

  if (query.isUnavailable) return null;

  const total = data ? totalCostUsd(data.byModel) : 0;
  const spenders = (data?.byAgent ?? [])
    .filter((row) => row.costUsd >= ROUNDS_TO_A_VISIBLE_CENT_USD)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, TOP_SPENDERS);
  const top = spenders[0]?.costUsd ?? 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col rounded-lg border border-border bg-card p-6">
        <div className="mb-1 flex min-h-[32px] items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Spend
            {query.isFetching && (
              <Spinner
                size={12}
                label="Loading spend"
                className="text-muted-foreground"
              />
            )}
          </p>
          <div className="flex shrink-0 gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5">
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

        <div className="relative min-h-[132px]">
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
                          avatar={
                            agents.find((a) => a.id === spender.agentId)?.avatar
                          }
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
                    No spend in this period.
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
