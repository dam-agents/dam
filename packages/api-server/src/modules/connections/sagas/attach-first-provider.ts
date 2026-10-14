import { PROVIDER_TEMPLATE_IDS } from "api-server-api";
import { concatMap, filter, type Subscription } from "rxjs";

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  type ConnectionCreated,
  events$,
  EventType,
  ofType,
} from "../../../events.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A user's first agent is usually created before
 * any provider exists, so it gets no default provider and its first message
 * runs with no model key. When a provider is connected, every agent of the
 * owner holding no provider gets it, by the same choice a new agent's default
 * makes — an agent that would pick an older provider was detached on purpose
 * and stays as it is. Events are handled one at a time, so two providers
 * connected together cannot both land on one agent.
 */
export function startAttachFirstProviderSaga(
  attach: (owner: string, connectionId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<ConnectionCreated>(EventType.ConnectionCreated),
      filter((ev) => PROVIDER_TEMPLATE_IDS.has(ev.templateId)),
      concatMap(async (ev) => {
        try {
          await attach(ev.actorSub, ev.connectionKey);
        } catch (err) {
          getLogger().error(
            { connectionId: ev.connectionKey, reason: formatError(err) },
            "connections.attach_first_provider_failed",
          );
        }
      }),
    )
    .subscribe();
}
