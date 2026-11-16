import { TRPCError } from "@trpc/server";

import type { ArtifactStore } from "../domain/artifact-store.js";
import { isStoreUnavailable } from "./store-unavailable.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns a failure of the object store to serve
 * (`isStoreUnavailable`) into a SERVICE_UNAVAILABLE error that says so, for
 * every store call. The api-server
 * serves while the store is down, so only the features that store files fail,
 * with an error the caller can read, and they work again once the store is
 * back. Any other error passes through as it came.
 */
export function withUnreachableAsUnavailable(
  store: ArtifactStore,
): ArtifactStore {
  const guard =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args);
      } catch (err) {
        if (!isStoreUnavailable(err)) throw err;
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message:
            "the object store cannot be reached right now; files cannot be stored or read until it is back",
          cause: err,
        });
      }
    };
  return {
    put: guard(store.put),
    get: guard(store.get),
    getStream: guard(store.getStream),
    getRange: guard(store.getRange),
    exists: guard(store.exists),
    head: guard(store.head),
    delete: guard(store.delete),
    presignUpload: guard(store.presignUpload),
    presignDownload: guard(store.presignDownload),
  };
}
