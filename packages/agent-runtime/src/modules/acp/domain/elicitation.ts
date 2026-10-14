import { isNonNullObject } from "./frames.js";

export const ELICITATION_CREATE_METHOD = "elicitation/create";

export function advertisesFormElicitation(initialize: unknown): boolean {
  if (!isNonNullObject(initialize)) return false;
  const params = initialize.params;
  if (!isNonNullObject(params)) return false;
  const caps = params.clientCapabilities;
  if (!isNonNullObject(caps)) return false;
  const elicitation = caps.elicitation;
  return isNonNullObject(elicitation) && isNonNullObject(elicitation.form);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The harness reads client capabilities once, from
 * the first `initialize` it gets, and one harness serves every client. So the
 * runtime, not that first client, says form elicitation is supported, and
 * decides per request who can answer one.
 */
export function withFormElicitation<T>(initialize: T): T {
  if (!isNonNullObject(initialize)) return initialize;
  const params = isNonNullObject(initialize.params) ? initialize.params : {};
  const caps = isNonNullObject(params.clientCapabilities)
    ? params.clientCapabilities
    : {};
  const elicitation = isNonNullObject(caps.elicitation) ? caps.elicitation : {};
  return {
    ...initialize,
    params: {
      ...params,
      clientCapabilities: {
        ...caps,
        elicitation: { ...elicitation, form: {} },
      },
    },
  };
}

export function declinedElicitation(id: unknown): object {
  return { jsonrpc: "2.0", id, result: { action: "decline" } };
}
