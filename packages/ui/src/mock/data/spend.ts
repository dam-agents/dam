import { AGENT_IDS } from "./agents.js";

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();

function day(d: number): string {
  return new Date(year, month, d).toISOString().slice(0, 10);
}

export const spendBreakdown = {
  byModel: [
    {
      model: "claude-sonnet-4-20250514",
      calls: 1842,
      inputTokens: 4_200_000,
      outputTokens: 1_350_000,
      cacheReadTokens: 800_000,
      cacheCreationTokens: 120_000,
      costUsd: 28.45,
      durationMs: 342_000,
    },
    {
      model: "claude-haiku-4-5-20251001",
      calls: 3260,
      inputTokens: 2_100_000,
      outputTokens: 680_000,
      cacheReadTokens: 400_000,
      cacheCreationTokens: 50_000,
      costUsd: 6.12,
      durationMs: 98_000,
    },
    {
      model: "gemini-2.5-pro",
      calls: 420,
      inputTokens: 900_000,
      outputTokens: 310_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 3.87,
      durationMs: 72_000,
    },
  ],
  byAgent: [
    {
      agentId: AGENT_IDS.codexResearch,
      agentName: "brand-asset-generator",
      costUsd: 14.22,
    },
    {
      agentId: AGENT_IDS.claudeCodeMain,
      agentName: "packaging-layouts",
      costUsd: 9.83,
    },
    {
      agentId: AGENT_IDS.geminiPipeline,
      agentName: "photo-retouching",
      costUsd: 7.61,
    },
    {
      agentId: AGENT_IDS.knowledgeBase,
      agentName: "brand-guidelines",
      costUsd: 4.18,
    },
    {
      agentId: AGENT_IDS.experiment1,
      agentName: "color-palette-testing",
      costUsd: 2.6,
    },
  ],
  byDay: [
    { day: day(1), costUsd: 1.2 },
    { day: day(2), costUsd: 2.8 },
    { day: day(3), costUsd: 1.9 },
    { day: day(4), costUsd: 3.4 },
    { day: day(5), costUsd: 2.1 },
    { day: day(6), costUsd: 0.6 },
    { day: day(7), costUsd: 0.3 },
    { day: day(8), costUsd: 3.9 },
    { day: day(9), costUsd: 4.2 },
    { day: day(10), costUsd: 2.7 },
    { day: day(11), costUsd: 3.1 },
    { day: day(12), costUsd: 1.8 },
    { day: day(13), costUsd: 0.4 },
    { day: day(14), costUsd: 0.2 },
    { day: day(15), costUsd: 2.5 },
    { day: day(16), costUsd: 3.6 },
    { day: day(17), costUsd: 1.4 },
    { day: day(18), costUsd: 2.5 },
  ],
};
