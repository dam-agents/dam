import type { EventOutcomeHandler } from "./hello-handler.js";

// UNIT_BOUNDARY_DESCRIPTION: Holds the handlers that react to an event report, several per event kind, and hands out one handler that runs them all. It is its own module because the fan-out must isolate its handlers: the reactions to one report are unrelated to each other, the event report is already claimed by the time they run, and a throwing reaction would otherwise take the rest of them down with it — a failed workspace mutation would stop failing its Invocation because the hint handler beside it raised.

export interface EventOutcomeRegistry {
  add: (kind: string, handler: EventOutcomeHandler) => void;
  dispatch: (kind: string) => EventOutcomeHandler | undefined;
}

export function createEventOutcomeRegistry(deps: {
  log: (msg: string) => void;
}): EventOutcomeRegistry {
  const handlers = new Map<string, EventOutcomeHandler[]>();
  return {
    add(kind, handler) {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
    },
    dispatch(kind) {
      const forKind = handlers.get(kind);
      if (!forKind) return undefined;
      return async (event, input) => {
        for (const handler of forKind) {
          try {
            await handler(event, input);
          } catch (err) {
            deps.log(
              `${event.agentId}: ${kind} outcome handler failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }
      };
    },
  };
}
