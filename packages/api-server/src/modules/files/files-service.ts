import type * as k8s from "@kubernetes/client-node";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import type { AppRouter as AgentRuntimeRouter } from "agent-runtime-api";
import type { FilesService } from "api-server-api";
import { emit, EventType, type TurnOutcome } from "../../events.js";
import { createAgentsRepository } from "../agents/index.js";
import { createK8sClient, podBaseUrl } from "../agents/infrastructure/k8s.js";

export function composeFilesModule(
  api: k8s.CoreV1Api,
  namespace: string,
  ownerSub: string,
): FilesService {
  const agentsRepo = createAgentsRepository(createK8sClient(api, namespace));
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
          outcome,
          bytes,
        });
      const runtime = createTRPCClient<AgentRuntimeRouter>({
        links: [
          httpBatchLink({
            url: `http://${podBaseUrl(input.agentId, namespace)}/api/trpc`,
          }),
        ],
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
          // CONFLICT is the overwrite handshake — UI re-issues with overwrite.
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
