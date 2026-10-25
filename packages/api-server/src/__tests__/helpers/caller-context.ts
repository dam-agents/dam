import type { ApiContext } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A fake ApiContext for router tests whose caller
 * is no Agent Editor: every Agent Permission check lets the procedure run as
 * the caller, as it does for an owner, an API key or a stranger.
 */
export function callerContext(fields: object): ApiContext {
  const ctx = {
    ...fields,
    actOnAgent: async () => ({ ok: true as const, ctx }),
  } as unknown as ApiContext;
  return ctx;
}
