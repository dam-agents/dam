import { match } from "ts-pattern";

const HARNESS_NONE = "none";
const HARNESS_UNKNOWN = "unknown";
const HARNESS_OTHER = "other";

export type AgentHarness =
  { agent: "unresolved" } | { agent: "resolved"; harness?: string };

export type HarnessOf = (agentId: string, named?: string) => string;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness a usage event ran on, bounded by the
 * install's catalog. The harness a session names wins; otherwise the agent's
 * own. An agent with none reads as none, one the cache cannot resolve as
 * unknown, and a name the install does not carry folds to other.
 */
export function createHarnessResolver(deps: {
  harnessOf: (agentId: string) => AgentHarness;
  known: ReadonlySet<string>;
}): HarnessOf {
  const fold = (harness: string): string =>
    deps.known.has(harness) ? harness : HARNESS_OTHER;
  return (agentId, named) =>
    named !== undefined
      ? fold(named)
      : match(deps.harnessOf(agentId))
          .with({ agent: "unresolved" }, () => HARNESS_UNKNOWN)
          .with({ agent: "resolved" }, ({ harness }) =>
            harness ? fold(harness) : HARNESS_NONE,
          )
          .exhaustive();
}
