import type {
  DefaultKind,
  OwnerModelCatalogView,
  SessionPair,
} from "api-server-api";
import { harnessCapabilityOf, runSubagentSettings } from "./session-pair.js";

/* UNIT_BOUNDARY_DESCRIPTION: what a run asks its agent for, as the resolver that answers it: the pair of a kind, its own harness, provider or model where the caller names them (D193B). */
export type ResolvePair = (
  agentId: string,
  kind: DefaultKind,
  wanted: { harness?: string; provider?: string; model?: string },
) => Promise<SessionPair | null | undefined>;

/* UNIT_BOUNDARY_DESCRIPTION: what settling a pair needs, and the only two inputs that cost anything: the agent's carried harnesses and the owner's catalog for its Connections, which lists models from the providers (D193B). */
export interface RunInputs {
  capabilities: unknown;
  catalog: Pick<OwnerModelCatalogView, "providers"> | null | undefined;
}

/* UNIT_BOUNDARY_DESCRIPTION: a pair settled by those inputs, with no I/O left: the derivation itself is pure, so it is safe inside a transaction that already holds a connection (D193B). */
export interface SettledPairs {
  pair(pair: SessionPair | null | undefined): SessionPair | null | undefined;
  settings(
    pair: Pick<SessionPair, "harness" | "provider" | "model">,
    settings: Record<string, string> | undefined,
  ): Record<string, string> | undefined;
}

export interface RunBoundary {
  /** UNIT_BOUNDARY_DESCRIPTION: the inputs a settle needs, fetched before any transaction opens, so no provider discovery runs inside one. */
  inputs(agentId: string): Promise<RunInputs>;
  /** UNIT_BOUNDARY_DESCRIPTION: those inputs as the settle itself. */
  settle(inputs: RunInputs): SettledPairs;
  /** UNIT_BOUNDARY_DESCRIPTION: a pair with the settings a run on it takes, the native subagent keys derived from its slot; the pair itself where it holds no settings. */
  pair(
    agentId: string,
    pair: SessionPair | null | undefined,
  ): Promise<SessionPair | null | undefined>;
  /** UNIT_BOUNDARY_DESCRIPTION: the settings a run on that pair takes, in place of the ones it holds. */
  settings(
    agentId: string,
    pair: Pick<SessionPair, "harness" | "provider" | "model">,
    settings: Record<string, string> | undefined,
  ): Promise<Record<string, string> | undefined>;
  /** UNIT_BOUNDARY_DESCRIPTION: what a run asking for these resolves to, with those settings: the one step a chat, a channel and a schedule take before their payload goes out. */
  resolve(
    agentId: string,
    kind: DefaultKind,
    wanted: { harness?: string; provider?: string; model?: string },
  ): Promise<SessionPair | null | undefined>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one helper every path that builds a run's payload
 * uses, so a new path cannot skip the derivation (D193B): a pair is settled
 * once, by the settings the one rule derives against the model the run starts
 * on, and a resolver settles what it answers before the caller sees it.
 * Settling is split in two: `inputs` is the only part that reads the owner's
 * catalog or the agent's capabilities, so a caller holding a transaction
 * fetches the inputs first and settles inside it, and never runs provider
 * discovery with a connection held.
 */
export function createRunBoundary(deps: {
  inputsOf: (agentId: string) => Promise<RunInputs>;
  resolvePair?: ResolvePair;
}): RunBoundary {
  const settle = (inputs: RunInputs): SettledPairs => {
    const capabilityOf = (harness: string) =>
      harnessCapabilityOf(inputs.capabilities, harness);
    const settings = (
      pair: Pick<SessionPair, "harness" | "provider" | "model">,
      given: Record<string, string> | undefined,
    ): Record<string, string> | undefined => {
      const derived = runSubagentSettings(
        capabilityOf(pair.harness),
        inputs.catalog,
        pair,
        given,
      );
      return Object.keys(derived).length > 0 ? derived : undefined;
    };
    return {
      settings,
      pair: (ofRun) => {
        if (!ofRun) return ofRun;
        const derived = settings(ofRun, ofRun.settings);
        const { settings: _held, ...rest } = ofRun;
        return derived ? { ...rest, settings: derived } : rest;
      },
    };
  };

  const settled = async (
    agentId: string,
    pair: SessionPair | null | undefined,
  ) => settle(await deps.inputsOf(agentId)).pair(pair);

  return {
    settle,
    inputs: (agentId) => deps.inputsOf(agentId),
    pair: settled,
    settings: async (agentId, pair, held) =>
      settle(await deps.inputsOf(agentId)).settings(pair, held),
    resolve: async (agentId, kind, wanted) => {
      if (!deps.resolvePair) return undefined;
      const [inputs, resolved] = await Promise.all([
        deps.inputsOf(agentId),
        deps.resolvePair(agentId, kind, wanted),
      ]);
      return settle(inputs).pair(resolved);
    },
  };
}
