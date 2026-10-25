import type { Sender } from "agent-runtime-api";
import { isNonNullObject, isRequest, isResponse } from "api-server-api";

const SENT_BY_A_PERSON = new Set([
  "session/prompt",
  "platform/updateQueued",
  "platform/rewriteFrom",
]);

function withPlatformStamp(
  holder: Record<string, unknown>,
  key: "sender" | "answeredBy",
  person: Sender,
): Record<string, unknown> {
  const meta = isNonNullObject(holder._meta) ? holder._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  return {
    ...holder,
    _meta: { ...meta, platform: { ...platform, [key]: person } },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the person signed in on the chat socket
 * into the frames that make them a Sender (a prompt, a queue edit, a rewrite)
 * and into their answer to a permission request. It replaces whatever the
 * client wrote there, because only the relay knows who is signed in. Null
 * when the frame needs no stamp, so the relay passes it on unchanged.
 */
export function stampSender(frame: unknown, person: Sender): object | null {
  if (isRequest(frame) && SENT_BY_A_PERSON.has(frame.method)) {
    const params = isNonNullObject(frame.params) ? frame.params : {};
    return { ...frame, params: withPlatformStamp(params, "sender", person) };
  }
  if (isResponse(frame) && isNonNullObject(frame.result)) {
    return {
      ...frame,
      result: withPlatformStamp(frame.result, "answeredBy", person),
    };
  }
  return null;
}
