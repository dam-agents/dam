import { agentServiceClient } from "../../core/agent-service-client.js";

const SESSION_LOOKUP_TIMEOUT_MS = 2_000;

export const SESSION_ID_HEADER = "x-platform-session-id";

export interface SessionNamed {
  ref?: string;
  sessionId?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Session a driver script says it runs in.
 * The SDK copies it from the script's environment: Pi's Session ref, or the
 * Session id a harness or a terminal sets on its shell commands. Pi sets a
 * blank ref outside a chat Session, which names none, so a blank value is
 * dropped.
 */
export function sessionNamedBy(
  ref: string | undefined,
  sessionId: string | undefined,
): SessionNamed | null {
  const named: SessionNamed = {
    ...(ref?.trim() ? { ref: ref.trim() } : {}),
    ...(sessionId?.trim() ? { sessionId: sessionId.trim() } : {}),
  };
  return named.ref !== undefined || named.sessionId !== undefined
    ? named
    : null;
}

export interface DriverSessions {
  byRef(ref: string): Promise<string | null>;
  knows(sessionId: string): Promise<boolean>;
}

export function runtimeDriverSessions(
  namespace: string,
): (driverId: string) => DriverSessions {
  return (driverId) => {
    const runtime = agentServiceClient(driverId, namespace, {
      timeoutMs: SESSION_LOOKUP_TIMEOUT_MS,
    });
    return {
      byRef: async (ref) =>
        (await runtime.sessions.byRef.query({ ref })).sessionId,
      knows: async (sessionId) =>
        (await runtime.sessions.list.query({ sessionId })).sessions.some(
          (s) => s.sessionId === sessionId,
        ),
    };
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver's Session a script spawn records, so
 * its sub-agent shows only in that Session's chat. The Driver's runtime
 * decides: a Session ref names the Session it was handed to, and a Session id
 * counts only when the runtime tracks that Session. A value the runtime does
 * not know, or a runtime that does not answer, records none, and the spawn
 * still runs, shown in every chat as before.
 */
export function scriptSpawningSession(
  sessionsOf: (driverId: string) => DriverSessions,
  warn: (message: string, err?: unknown) => void = console.warn,
): (driverId: string, named: SessionNamed) => Promise<string | null> {
  return async (driverId, named) => {
    const sessions = sessionsOf(driverId);
    try {
      if (named.ref !== undefined) {
        const sessionId = await sessions.byRef(named.ref);
        if (sessionId !== null) return sessionId;
      }
      if (
        named.sessionId !== undefined &&
        (await sessions.knows(named.sessionId))
      )
        return named.sessionId;
      warn(
        `[invocations] ${driverId}: the script names a session the runtime does not track; the sub-agent shows in every chat`,
      );
    } catch (err) {
      warn(
        `[invocations] ${driverId}: could not resolve the script's session; the sub-agent shows in every chat`,
        err,
      );
    }
    return null;
  };
}
