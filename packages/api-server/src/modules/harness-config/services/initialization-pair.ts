import type { SessionPair } from "api-server-api";
import { NoDefaultModelError } from "../domain/no-default-model.js";

interface PendingEvent {
  kind: string;
  payload: unknown;
}

const fieldOf = (payload: unknown, key: "harness" | "model"): unknown =>
  (payload as Record<string, unknown> | null)?.[key];

/**
 * UNIT_BOUNDARY_DESCRIPTION: a kit's onboarding turn is queued at apply,
 * before a new Agent has said hello, so it names no model: the Agent gets its
 * saved default only once its runtime lists its provider. Such a turn (an
 * `initialization` Event that names no model, a kit update's too) takes the
 * saved default each time it is delivered, on the harness it names if any,
 * so it runs on the default saved after it was queued; the caller converts
 * the Agent's default first when none is saved yet, so a provider that
 * listed too late for the conversion at hello is tried again on each
 * delivery. While there is no default model to run on, it is held back
 * rather than sent, since the runtime refuses a turn with no model; it goes
 * out on a later delivery, once the default is saved. A turn
 * that names its model, any other event, and an Agent on an older runtime
 * pass as stored, and so does a turn whose default cannot be read, so a
 * failed read never drops it.
 */
export function createInitializationPairResolver(deps: {
  firePair: (
    agentId: string,
    preferred: { harness?: string },
  ) => Promise<SessionPair | null | undefined>;
  log: (msg: string) => void;
}): <E extends PendingEvent>(agentId: string, event: E) => Promise<E | null> {
  return async (agentId, event) => {
    if (
      event.kind !== "initialization" ||
      fieldOf(event.payload, "model") !== undefined
    )
      return event;
    const harness = fieldOf(event.payload, "harness");
    let pair: SessionPair | null | undefined;
    try {
      pair = await deps.firePair(
        agentId,
        typeof harness === "string" ? { harness } : {},
      );
    } catch (err) {
      if (err instanceof NoDefaultModelError) return null;
      deps.log(
        `[initialization-pair] ${agentId}: default not read, the turn goes as queued: ${(err as Error).message}`,
      );
      return event;
    }
    if (!pair?.model) return event;
    return {
      ...event,
      payload: {
        ...(event.payload as object),
        harness: pair.harness,
        ...(pair.provider !== null && { provider: pair.provider }),
        model: pair.model,
        ...(pair.settings && { settings: pair.settings }),
      },
    };
  };
}
