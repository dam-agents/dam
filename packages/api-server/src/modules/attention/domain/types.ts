export const ATTENTION_RETENTION_DAYS = 90;

export type AttentionItemKind = "session" | "approval";

export interface AttentionRecordRow {
  agentId: string;
  sessionId: string;
  ownerSub: string;
  mode: string;
  type: string;
  title: string | null;
  scheduleId: string | null;
  experimentId: string | null;
  createdAt: Date;
  activityAt: Date | null;
  seenAt: Date | null;
  working: boolean;
}

export interface DismissalRow {
  kind: AttentionItemKind;
  itemId: string;
  dismissedAt: Date;
}

export function sessionItemId(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a freshly captured record says anything the
 * stored one does not. Capture runs on every pod notice, most of which concern a
 * session this one did not change, so the writer compares before it writes and
 * skips the unchanged — no row touched, no event emitted, no hint fanned out.
 * Capture time is excluded deliberately: it moves on every read and would make
 * every comparison differ.
 */
export function sameRecord(
  stored: AttentionRecordRow,
  next: AttentionRecordRow,
): boolean {
  return (
    stored.ownerSub === next.ownerSub &&
    stored.mode === next.mode &&
    stored.type === next.type &&
    stored.title === next.title &&
    stored.scheduleId === next.scheduleId &&
    stored.experimentId === next.experimentId &&
    stored.working === next.working &&
    sameTime(stored.createdAt, next.createdAt) &&
    sameTime(stored.activityAt, next.activityAt) &&
    sameTime(stored.seenAt, next.seenAt)
  );
}
