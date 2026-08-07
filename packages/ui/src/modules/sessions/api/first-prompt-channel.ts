import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType } from "api-server-api";

import { openConnection } from "../../acp/acp.js";
import type { UpdateHandler } from "../../acp/types.js";

export interface FirstPromptChannel {
  connection: ClientSideConnection;
  ws: WebSocket;
  /** The session this channel just created. Nothing else knows about it yet. */
  sessionId: string;
}

/**
 * Open a connection that exists to carry one session's *first* prompt, and
 * create that session on it.
 *
 * Deliberately private: the socket is not registered as the chat's live
 * connection, so nothing that tears the live connection down — opening another
 * session, going back, resetting the chat — can close it or repoint it at a
 * different session while the prompt is still on its way. That is the whole
 * point. A first prompt is the one send with no session to belong to yet, so it
 * is the one send that cannot survive borrowing the view's connection: the
 * caller can navigate away in the milliseconds it takes to create a session,
 * and the prompt would die with the connection it borrowed (#2963).
 *
 * The caller owns the socket from here: hand it to the connection hook once the
 * prompt is delivered and the chat is still on this session, or close it and let
 * the turn finish server-side.
 */
export async function openFirstPromptChannel(
  agentId: string,
  onUpdate: UpdateHandler,
): Promise<FirstPromptChannel> {
  const { connection, ws } = await openConnection(agentId, onUpdate);
  try {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    // Stamp platform metadata so the session records as a regular chat session
    // rather than decoding as terminal-by-default.
    const session = await connection.newSession({
      cwd: ".",
      mcpServers: [],
      _meta: {
        platform: { mode: SessionMode.Chat, type: SessionType.Regular },
      },
    });
    return { connection, ws, sessionId: session.sessionId };
  } catch (err) {
    // Nothing has adopted this socket, so nothing else will close it.
    try {
      ws.close();
    } catch {}
    throw err;
  }
}
