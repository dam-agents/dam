import type { SessionPair } from "api-server-api";
import { match } from "ts-pattern";

import { pairMeta } from "./session-pair-options.js";

export type TerminalLaunch =
  { kind: "harness"; pair: SessionPair } | { kind: "shell" };

// UNIT_BOUNDARY_DESCRIPTION: what the first connection of a new web terminal asks the runtime to start, as query parameters: a harness pair, or `shell=1` for the agent user's login shell, which names no harness, provider or model. No launch asks for nothing, so the runtime starts its default harness.
export function terminalLaunchMeta(
  launch: TerminalLaunch | null,
): Record<string, string> | null {
  if (launch === null) return null;
  return match(launch)
    .with({ kind: "harness" }, ({ pair }) => pairMeta(pair))
    .with({ kind: "shell" }, () => ({ shell: "1" }))
    .exhaustive();
}
