import type { IncomingMessage } from "node:http";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";

export const SESSION_HEADER = "x-platform-session";

export interface SessionHandle {
  sessionId: string;
  parentSessionId?: string;
}

const CLAUDE_SESSION_IN_USER_ID = /_session_([0-9a-f-]{36})$/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code 2.1 stamps `metadata.user_id` with
 * a JSON object (`session_id`, `parent_session_id` for a forked subagent,
 * device and account ids); older releases stamped
 * `user_<hash>_account_<uuid>_session_<uuid>`. Both name the session.
 */
const claudeUserId = (
  userId: string,
): { session_id?: string; parent_session_id?: string } | null => {
  if (!userId.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(userId);
    if (!parsed || typeof parsed !== "object") return null;
    const { session_id, parent_session_id } = parsed as Record<string, unknown>;
    return {
      ...(typeof session_id === "string" && { session_id }),
      ...(typeof parent_session_id === "string" && { parent_session_id }),
    };
  } catch {
    return null;
  }
};

const header = (req: IncomingMessage, name: string): string | null => {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: which Session a model call belongs to, read from
 * what each harness stamps on its calls: Bob's `X-Task-Id` with
 * `X-Parent-Task-Id` on a subagent's calls, Codex's `session-id` header with
 * a subagent's own `thread-id`, Claude Code's request metadata `user_id`,
 * which ends in `_session_<uuid>`, Pi's `x-platform-session` from its
 * extension. The root ids equal the ACP session id, except in a Codex or Bob
 * terminal, whose own id the caller maps back.
 */
export function sessionOf(
  req: IncomingMessage,
  body: Record<string, unknown>,
): SessionHandle | null {
  const marked = harnessSessionOf(req, body);
  if (marked) return marked;
  const stamped = sessionStampOf(req);
  return stamped ? { sessionId: stamped } : null;
}

export function sessionStampOf(req: IncomingMessage): string | null {
  return header(req, SESSION_HEADER);
}

function harnessSessionOf(
  req: IncomingMessage,
  body: Record<string, unknown>,
): SessionHandle | null {
  const task = header(req, "x-task-id");
  if (task) {
    const parent = header(req, "x-parent-task-id");
    return parent
      ? { sessionId: task, parentSessionId: parent }
      : { sessionId: task };
  }
  const codex = header(req, "session-id") ?? header(req, "session_id");
  if (codex) {
    const thread = header(req, "thread-id");
    return thread && thread !== codex
      ? { sessionId: thread, parentSessionId: codex }
      : { sessionId: codex };
  }
  const metadata = body.metadata;
  const userId =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).user_id
      : undefined;
  if (typeof userId !== "string") return null;
  const stamped = claudeUserId(userId);
  if (stamped?.session_id) {
    const parent = stamped.parent_session_id;
    return parent && parent !== stamped.session_id
      ? { sessionId: stamped.session_id, parentSessionId: parent }
      : { sessionId: stamped.session_id };
  }
  const legacy = CLAUDE_SESSION_IN_USER_ID.exec(userId);
  if (legacy?.[1]) return { sessionId: legacy[1] };
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness whose calls carry no session marker
 * (Copilot) serves every session from one process; while exactly one of its
 * sessions runs a turn, an unmarked call is that turn's, so its spend is the
 * session's. With several turns at once the call names none.
 */
export function sessionOfRunningTurn(
  binding: ModelRouterBinding | undefined,
  running: readonly string[],
): SessionHandle | null {
  return binding?.sessionFromRunningTurn && running.length === 1
    ? { sessionId: running[0]! }
    : null;
}
