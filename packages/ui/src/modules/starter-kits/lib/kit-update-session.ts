import {
  type KitUpdatePending,
  SessionType,
  type SessionView,
} from "api-server-api";

export function isKitUpdateSession(
  session: Pick<SessionView, "initialization" | "type" | "createdAt">,
  pending: KitUpdatePending | null,
): boolean {
  return (
    pending !== null &&
    session.initialization === true &&
    session.type === SessionType.Regular &&
    Date.parse(session.createdAt) >= Date.parse(pending.startedAt)
  );
}
