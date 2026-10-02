import type { TurnSummary } from "api-server-api";

import { agentHistory } from "../agent-fixtures";
import { at } from "../platform";
import { ago, IDS, whenPopulated } from "../scenario";
import { AGENTS } from "./agents";

const MODEL_CATALOG = {
  [IDS.codingAgent]: [
    { value: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { value: "claude-opus-4-1", name: "Claude Opus 4.1" },
    { value: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  [IDS.kbAgent]: [
    { value: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { value: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  [IDS.slackAgent]: [
    { value: "gpt-5-codex", name: "GPT-5 Codex" },
    { value: "gpt-5", name: "GPT-5" },
  ],
  [IDS.hibernatedAgent]: [
    { value: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  ],
} as Record<string, { value: string; name: string }[]>;

/** Telemetry turns derived from the replayed transcript, one per prompt, so
 *  the per-reply telemetry lines up with the conversation the chat shows. */
export function turnsFor(
  agentId: string,
  sessionId: string | undefined,
): TurnSummary[] {
  const frames = sessionId ? (agentHistory(agentId)[sessionId] ?? []) : [];
  const turns: TurnSummary[] = [];
  let start: string | null = null;
  let last: string | null = null;
  let calls = 0;
  const flush = () => {
    if (!start || !last) return;
    const durationMs = Date.parse(last) - Date.parse(start);
    const n = turns.length + 1;
    turns.push({
      turnId: `${sessionId}-turn-${n}`,
      promptId: null,
      groupedBy: "time",
      startedAt: start,
      endedAt: last,
      durationMs,
      prompted: true,
      rootName: "claude_code.interaction",
      spanCount: calls * 3 + 2,
      recordCount: calls * 4 + 3,
      errorCount: 0,
      traceIds: [`4bf92f3577b34da6a3ce929d0e0e${4736 + n}`],
      models: [MODEL_CATALOG[agentId]?.[0]?.value ?? "claude-sonnet-4-5"],
      calls: calls + 1,
      costUsd: Math.round((0.012 + calls * 0.021) * 1000) / 1000,
      inputTokens: 2_400 + calls * 3_150,
      outputTokens: 180 + calls * 240,
      cacheReadTokens: 11_800 + calls * 9_600,
      cacheCreationTokens: 3_200 + calls * 410,
    });
  };
  for (const { update, at: t } of frames) {
    if (!t) continue;
    if (update.sessionUpdate === "user_message_chunk") {
      flush();
      start = t;
      calls = 0;
    } else if (update.sessionUpdate === "tool_call") {
      calls += 1;
    }
    last = t;
  }
  flush();
  return turns;
}

const kbAgents = () =>
  whenPopulated(AGENTS, []).filter((a) => a.kind === "knowledge-base");

export const chatEntries = [
  at("harnessConfig.status", ({ agentId }) => ({
    supported: true,
    catalog: {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: MODEL_CATALOG[agentId] ?? [],
        },
      ],
    },
  })),
  at("harnessConfig.snapshot", ({ agentId }) => {
    const models = MODEL_CATALOG[agentId] ?? [];
    return {
      hasRun: true,
      snapshot: {
        model: models[0]?.value ?? null,
        mode: "default",
        configOptions: {},
        availableModels: models,
        capturedAt: ago(agentId === IDS.hibernatedAgent ? 60 * 24 * 3 : 12),
        modelAtDiscovery: models[0]?.value ?? null,
        confirmed: true,
      },
    };
  }),
  at("harnessConfig.settled", () => ({ settled: true })),
  at("telemetry.turns", ({ agentId, sessionId }) => ({
    available: true as const,
    turns: turnsFor(agentId, sessionId),
    truncated: false,
  })),
  at("kbShares.status", ({ agentId }) =>
    kbAgents().some((a) => a.id === agentId)
      ? {
          agentId,
          publicName: "Platform docs",
          roots: ["wiki"],
          publishState: "idle" as const,
          publishError: null,
          snapshotCreatedAt: ago(60 * 3 - 5),
          documentCount: 42,
          totalSizeBytes: 318_204,
          queryCount: 127,
          lastUsedAt: ago(25),
          createdAt: ago(60 * 24 * 21),
        }
      : null,
  ),
  at("kbShares.defaults", () => ({
    roots: ["wiki"],
    workspace: { state: "listed" as const, roots: ["raw", "wiki"] },
  })),
];
