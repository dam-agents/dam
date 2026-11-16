import { concatMap, filter, merge, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type ConnectionCreated,
  type ConnectionCredentialChanged,
} from "../../../events.js";
import type { PriceReader } from "../services/price-reader.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Connection of a provider with its own price
 * list is read as soon as it is created or its key is replaced, so a key
 * that reaches models no other key reaches brings their prices at once,
 * without waiting for the hourly read.
 */
export function startReadPricesOnConnectionSaga(deps: {
  reader: PriceReader;
  hasPriceListing: (templateId: string) => boolean;
}): Subscription {
  return merge(
    events$().pipe(ofType<ConnectionCreated>(EventType.ConnectionCreated)),
    events$().pipe(
      ofType<ConnectionCredentialChanged>(
        EventType.ConnectionCredentialChanged,
      ),
    ),
  )
    .pipe(
      filter((event) => deps.hasPriceListing(event.templateId)),
      concatMap(async (event) => {
        try {
          await deps.reader.readOne(event.connectionKey);
        } catch (err) {
          getLogger().error(
            { connectionId: event.connectionKey, reason: formatError(err) },
            "spend.connection_prices_not_read",
          );
        }
      }),
    )
    .subscribe();
}
