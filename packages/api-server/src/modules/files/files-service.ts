import { TRPCClientError } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import type { FilesService } from "api-server-api";
import { agentPodClient } from "../../core/agent-pod-client.js";
import { emit, EventType, type TurnOutcome } from "../../events.js";
import type { AgentsRepository } from "../agents/index.js";

// UNIT_BOUNDARY_DESCRIPTION: an upload carries up to the user request-body bound — 32 MB, base64-encoded on the wire — to the Agent's own disk, so its budget is a write budget, not a round-trip one.
const UPLOAD_TIMEOUT_MS = 60_000;

export function composeFilesModule(
  agentsRepo: Pick<AgentsRepository, "isOwnedBy">,
  namespace: string,
  ownerSub: string,
  surface: string,
): FilesService {
  return {
    async upload(input) {
      if (!(await agentsRepo.isOwnedBy(input.agentId, ownerSub))) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const bytes = Math.floor(input.contentBase64.length * 0.75);
      const fire = (outcome: TurnOutcome) =>
        emit({
          type: EventType.FilesImported,
          actorSub: ownerSub,
          agentId: input.agentId,
          surface,
          outcome,
          bytes,
        });
      const runtime = agentPodClient(input.agentId, namespace, {
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      try {
        const result = await runtime.files.upload.mutate({
          path: input.path,
          contentBase64: input.contentBase64,
          contentType: input.contentType,
          overwrite: input.overwrite,
        });
        fire("success");
        return result;
      } catch (err) {
        if (err instanceof TRPCClientError) {
          const code = (err.data as { code?: TRPCError["code"] } | undefined)
            ?.code;
          if (code !== "CONFLICT") fire("failure");
          throw new TRPCError({
            code: code ?? "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        fire("failure");
        throw err;
      }
    },
  };
}
