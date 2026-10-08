import { Pause, Renew } from "@carbon/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface MockExperimentDashboardProps {
  experimentName: string;
  frameworks: string[];
  onClose?: () => void;
}

interface SpanEntry {
  stage: string;
  iteration: number;
  score: number;
  status: "done" | "running";
  framework?: string;
}

export function MockExperimentDashboard({
  experimentName,
  frameworks,
  onClose,
}: MockExperimentDashboardProps) {
  const [spans, setSpans] = useState<SpanEntry[]>([]);
  const [status, setStatus] = useState<"running" | "completed">("running");
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const iterRef = useRef(0);

  const isHorseRace = frameworks.length > 1;

  useEffect(() => {
    const stages = ["init", "generate", "evaluate", "select"];
    let stageIdx = 0;

    intervalRef.current = setInterval(() => {
      iterRef.current++;
      const iter = iterRef.current;

      if (iter > 18) {
        setStatus("completed");
        clearInterval(intervalRef.current);
        return;
      }

      const stage = stages[stageIdx % stages.length]!;
      stageIdx++;

      if (isHorseRace) {
        const newSpans = frameworks.map((fw) => ({
          stage,
          iteration: Math.ceil(iter / stages.length),
          score: Math.min(0.95, 0.3 + iter * 0.035 + Math.random() * 0.05),
          status: "done" as const,
          framework: fw,
        }));
        setSpans((prev) => [...prev, ...newSpans]);
      } else {
        setSpans((prev) => [
          ...prev,
          {
            stage,
            iteration: Math.ceil(iter / stages.length),
            score: Math.min(0.95, 0.3 + iter * 0.035 + Math.random() * 0.05),
            status: "done" as const,
          },
        ]);
      }
    }, 800);

    return () => clearInterval(intervalRef.current);
  }, [frameworks, isHorseRace]);

  const bestScore = useMemo(() => {
    if (spans.length === 0) return null;
    return Math.max(...spans.map((s) => s.score));
  }, [spans]);

  const currentIteration = useMemo(() => {
    if (spans.length === 0) return 0;
    return Math.max(...spans.map((s) => s.iteration));
  }, [spans]);

  const frameworkScores = useMemo(() => {
    if (!isHorseRace) return null;
    const scores: Record<string, number[]> = {};
    for (const span of spans) {
      if (!span.framework) continue;
      if (!scores[span.framework]) scores[span.framework] = [];
      scores[span.framework].push(span.score);
    }
    return Object.entries(scores).map(([fw, s]) => ({
      framework: fw,
      best: Math.max(...s),
      latest: s[s.length - 1] ?? 0,
    }));
  }, [spans, isHorseRace]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {experimentName}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            status === "running"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              status === "running"
                ? "animate-pulse bg-emerald-500"
                : "bg-muted-foreground",
            )}
          />
          {status === "running" ? "Running" : "Completed"}
        </span>
        {status === "running" && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            title="Stop"
          >
            <Pause size={16} />
          </button>
        )}
      </div>

      {/* Dashboard body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Iteration"
            value={String(currentIteration)}
            sublabel={status === "running" ? "in progress" : "total"}
          />
          <StatCard
            label="Best score"
            value={bestScore !== null ? bestScore.toFixed(3) : "—"}
            sublabel={isHorseRace ? "across all" : ""}
          />
          <StatCard
            label="Spans"
            value={String(spans.length)}
            sublabel="reported"
          />
        </div>

        {/* Score chart - simplified bar representation */}
        {isHorseRace && frameworkScores && frameworkScores.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
              Framework comparison
            </p>
            <div className="space-y-2">
              {frameworkScores.map((fw) => (
                <div key={fw.framework} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-foreground">
                      {fw.framework}
                    </span>
                    <span className="text-[12px] text-muted-foreground tabular-nums">
                      {fw.best.toFixed(3)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground/70 transition-all duration-500"
                      style={{ width: `${fw.best * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Single framework score progression */}
        {!isHorseRace && spans.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
              Score progression
            </p>
            <div className="flex items-end gap-[3px] h-[60px]">
              {spans
                .filter((s) => s.stage === "evaluate")
                .slice(-20)
                .map((s, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-foreground/60 transition-all duration-300"
                    style={{ height: `${s.score * 100}%` }}
                  />
                ))}
            </div>
          </div>
        )}

        {/* Live spans feed */}
        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
              Live feed
            </p>
            {status === "running" && (
              <Renew size={16} className="animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="max-h-[180px] overflow-y-auto space-y-0.5">
            {spans
              .slice(-12)
              .reverse()
              .map((span, i) => (
                <div
                  key={`${span.stage}-${span.iteration}-${span.framework}-${i}`}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1 text-[12px]",
                    i === 0 && status === "running"
                      ? "bg-muted/60"
                      : "bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      span.stage === "evaluate"
                        ? "bg-foreground/60"
                        : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="text-muted-foreground min-w-[60px]">
                    {span.stage}
                  </span>
                  {span.framework && (
                    <span className="text-foreground/70 min-w-[70px]">
                      {span.framework}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-muted-foreground tabular-nums">
                    iter {span.iteration}
                  </span>
                  {span.stage === "evaluate" && (
                    <span className="text-foreground tabular-nums font-medium">
                      {span.score.toFixed(3)}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[18px] font-semibold tabular-nums text-foreground leading-tight">
        {value}
      </p>
      {sublabel && (
        <p className="text-[11px] text-muted-foreground">{sublabel}</p>
      )}
    </div>
  );
}
