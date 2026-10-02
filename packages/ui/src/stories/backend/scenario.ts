/** Stable ids shared by every fixture file, so cross-references line up. */
export const IDS = {
  codingAgent: "agent-3b1f6c2a5c2b7e01",
  kbAgent: "agent-3b1f6c2a5c2b7e02",
  slackAgent: "agent-3b1f6c2a5c2b7e03",
  hibernatedAgent: "agent-3b1f6c2a5c2b7e04",
  freshAgent: "agent-3b1f6c2a5c2b7e05",
  owner: "a3f1c2d4-5e6b-4c7d-8e9f-0a1b2c3d4e5f",
  session1: "7c9e2b10-0001-4a55-8f3e-1d2c3b4a5f01",
  session2: "7c9e2b10-0002-4a55-8f3e-1d2c3b4a5f02",
  session3: "7c9e2b10-0003-4a55-8f3e-1d2c3b4a5f03",
  kitCatalog: "curated",
  kit: "code-guardian",
} as const;

export type Scenario = "populated" | "empty";

let current: Scenario = "populated";

export function setScenario(s: Scenario) {
  current = s;
}

export function scenario(): Scenario {
  return current;
}

/** `value` when populated, `empty` otherwise. */
export function whenPopulated<T>(value: T, empty: T): T {
  return current === "populated" ? value : empty;
}

/** Fixed clock so relative times ("2h ago") render the same on every run. */
export const NOW = Date.now();
export const ago = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();
