import { WebSocket } from "ws";
import type { RedisBus } from "../../../core/redis-bus.js";
import { getLogger } from "../../../core/logger.js";
import { events$, EventType } from "../../../events.js";
import type { EditorStandingOf } from "./editor-runtime-access.js";

const RECHECK_CHANNEL = "agent-editors:recheck";

export const ACCESS_REVOKED_CODE = 4403;

interface EditorSocket {
  sub: string;
  email: string;
  client: WebSocket;
}

export interface EditorSockets {
  track(
    agentId: string,
    editor: { sub: string; email: string },
    client: WebSocket,
  ): void;
  close(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sockets Agent Editors hold open to a Shared
 * Agent on this replica. When the Agent's Editor List changes or the Agent is
 * deleted, the replica that saw it asks every replica, over the bus, to check
 * its editors of that Agent again. Each socket whose editor no longer stands
 * as an editor is closed with "access revoked", so a removed editor loses an
 * open chat at once and not only at their next connect.
 */
export function createEditorSockets(deps: {
  bus: RedisBus;
  editorStanding: EditorStandingOf;
}): EditorSockets {
  const open = new Map<string, Set<EditorSocket>>();

  async function recheck(agentId: string): Promise<void> {
    for (const socket of open.get(agentId) ?? []) {
      const standing = await deps.editorStanding(agentId, {
        sub: socket.sub,
        editorEmail: socket.email,
      });
      if (standing || socket.client.readyState !== WebSocket.OPEN) continue;
      try {
        socket.client.close(ACCESS_REVOKED_CODE, "access revoked");
      } catch {
        socket.client.terminate();
      }
    }
  }

  const unsubscribe = deps.bus.subscribe(RECHECK_CHANNEL, (payload) => {
    try {
      const { agentId } = JSON.parse(payload) as { agentId: string };
      recheck(agentId).catch((err: unknown) =>
        getLogger().warn({ err, agentId }, "editor_sockets.recheck_failed"),
      );
    } catch {}
  });

  const changes = events$().subscribe((event) => {
    if (
      event.type !== EventType.AgentEditorsChanged &&
      event.type !== EventType.AgentDeleted
    )
      return;
    void deps.bus.publish(
      RECHECK_CHANNEL,
      JSON.stringify({ agentId: event.agentId }),
    );
  });

  return {
    track(agentId, editor, client) {
      const socket = { ...editor, client };
      const sockets = open.get(agentId) ?? new Set<EditorSocket>();
      sockets.add(socket);
      open.set(agentId, sockets);
      client.once("close", () => {
        sockets.delete(socket);
        if (sockets.size === 0 && open.get(agentId) === sockets)
          open.delete(agentId);
      });
    },
    close() {
      unsubscribe();
      changes.unsubscribe();
    },
  };
}
