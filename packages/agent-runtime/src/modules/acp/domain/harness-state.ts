import { isNonNullObject } from "api-server-api";

const SDK_MESSAGE_METHOD = "_claude/sdkMessage";

const STATE_FILTER = { type: "system", subtype: "session_state_changed" };

const SESSION_OPENING_METHODS = new Set([
  "session/new",
  "session/load",
  "session/resume",
]);

export interface HarnessStateReport {
  sessionId: string;
  busy: boolean;
}

export interface HarnessStatePort {
  request(frame: unknown): unknown;
  read(frame: unknown): HarnessStateReport | null;
}

function isStateFilter(filter: unknown): boolean {
  return (
    isNonNullObject(filter) &&
    filter.type === STATE_FILTER.type &&
    filter.subtype === STATE_FILTER.subtype &&
    filter.origin === undefined
  );
}

function withStateFilter(current: unknown): unknown {
  if (current === true) return true;
  const filters = Array.isArray(current) ? current : [];
  return filters.some(isStateFilter) ? filters : [...filters, STATE_FILTER];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: How the runtime learns whether Claude Code is
 * still working on its own after it answered a prompt — a follow-up turn that
 * handles the reports of background agents. Claude Code reports every change
 * of its session state (`running`, `requires_action`, `idle`) as a
 * `session_state_changed` SDK message, and `idle` comes only once its
 * background agents are done. The adapter forwards those messages as
 * `_claude/sdkMessage` notifications when the session asks for them in
 * `_meta.claudeCode.emitRawSDKMessages`, on session/new, session/load and
 * session/resume. `request` adds that ask to each such frame, beside any filter
 * already there. Another harness ignores the key and sends no such
 * notification. `read` turns one notification into a busy or idle report.
 */
export const claudeSessionState: HarnessStatePort = {
  request(frame: unknown): unknown {
    if (!isNonNullObject(frame)) return frame;
    if (
      typeof frame.method !== "string" ||
      !SESSION_OPENING_METHODS.has(frame.method)
    )
      return frame;
    const params = isNonNullObject(frame.params) ? frame.params : {};
    const meta = isNonNullObject(params._meta) ? params._meta : {};
    const claudeCode = isNonNullObject(meta.claudeCode) ? meta.claudeCode : {};
    return {
      ...frame,
      params: {
        ...params,
        _meta: {
          ...meta,
          claudeCode: {
            ...claudeCode,
            emitRawSDKMessages: withStateFilter(claudeCode.emitRawSDKMessages),
          },
        },
      },
    };
  },

  read(frame: unknown): HarnessStateReport | null {
    if (!isNonNullObject(frame) || frame.method !== SDK_MESSAGE_METHOD)
      return null;
    const params = frame.params;
    if (!isNonNullObject(params) || typeof params.sessionId !== "string")
      return null;
    const message = params.message;
    if (
      !isNonNullObject(message) ||
      message.type !== STATE_FILTER.type ||
      message.subtype !== STATE_FILTER.subtype ||
      typeof message.state !== "string"
    )
      return null;
    return { sessionId: params.sessionId, busy: message.state !== "idle" };
  },
};
