import { TRPCClientError } from "@trpc/client";
import { agentServiceClient } from "../../../core/agent-service-client.js";
import { createAgentWorkspaceFiles } from "../../channels/infrastructure/agent-workspace-files.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's workspace as a Satellite's file
 * transfer needs it: write some bytes in, read some bytes out. Both halves
 * already existed for other callers — a spilled satellite log is written the
 * same way, and a channel attachment is read the same way — so this is the one
 * place that names both, and it turns the runtime's own refusals into the three
 * answers a transfer can act on.
 */
export type WorkspaceRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "not-found" | "too-large" | "unreachable" };

export interface SatelliteWorkspaceFiles {
  write(input: {
    agentId: string;
    path: string;
    bytes: Buffer;
  }): Promise<string>;
  read(input: { agentId: string; path: string }): Promise<WorkspaceRead>;
}

const READ_TIMEOUT_MS = 60_000;

export function createSatelliteWorkspaceFiles(
  namespace: string,
): SatelliteWorkspaceFiles {
  return {
    write: ({ agentId, path, bytes }) =>
      createAgentWorkspaceFiles(agentId, namespace).write({ path, bytes }),
    async read({ agentId, path }) {
      try {
        const file = await agentServiceClient(agentId, namespace, {
          timeoutMs: READ_TIMEOUT_MS,
          batch: false,
        }).files.read.query({ path });
        return {
          ok: true,
          bytes: file.binary
            ? Buffer.from(file.content, "base64")
            : Buffer.from(file.content, "utf8"),
        };
      } catch (err) {
        if (err instanceof TRPCClientError) {
          const code = (err.data as { code?: string } | undefined)?.code;
          if (code === "NOT_FOUND") return { ok: false, reason: "not-found" };
          if (code === "PAYLOAD_TOO_LARGE")
            return { ok: false, reason: "too-large" };
        }
        return { ok: false, reason: "unreachable" };
      }
    },
  };
}
