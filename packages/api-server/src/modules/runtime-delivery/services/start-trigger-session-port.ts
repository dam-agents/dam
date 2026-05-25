import type { CoreV1Api } from "@kubernetes/client-node";
import { SessionMode } from "api-server-api";
import type { Db } from "db";
import { LABEL_OWNER } from "../../agents/infrastructure/labels.js";
import { createK8sClient } from "../../agents/infrastructure/k8s.js";
import {
  composeAgentsModule,
  createKeycloakUserDirectory,
} from "../../agents/index.js";
import { composeTemplatesModule } from "../../templates/index.js";
import { composeSchedulesModule } from "../../schedules/index.js";
import { composeSessionsModule } from "../../sessions/index.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";
import { createAcpClient } from "../../../core/acp-client.js";
import type { StartTriggerSessionPort } from "./trigger-event-handler.js";

/**
 * Wires the existing acp + sessions + agents/schedules-ownership chain into
 * a StartTriggerSessionPort that the runtime-delivery trigger event handler
 * can call. Identical session-firing semantics to the legacy POST endpoint;
 * extracted so both the runtime channel and the legacy callback share one
 * code path.
 */
export interface StartTriggerSessionDeps {
  api: CoreV1Api;
  db: Db;
  namespace: string;
  channelSecretStore: ChannelSecretStore;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakApiClientId: string;
  keycloakApiClientSecret: string;
}

export function createStartTriggerSessionPort(
  deps: StartTriggerSessionDeps,
): StartTriggerSessionPort {
  const k8sClient = createK8sClient(deps.api, deps.namespace);
  const userDirectory = createKeycloakUserDirectory({
    keycloakUrl: deps.keycloakUrl,
    keycloakRealm: deps.keycloakRealm,
    clientId: deps.keycloakApiClientId,
    clientSecret: deps.keycloakApiClientSecret,
  });

  return {
    async start({ agentId, scheduleId, task, sessionMode, mcpServers }) {
      const instanceCm = await k8sClient.getConfigMap(agentId);
      const owner = instanceCm?.metadata?.labels?.[LABEL_OWNER];
      if (!owner) {
        throw new Error(`agent ${agentId}: missing owner label`);
      }

      const { readSpec: readTemplateSpec } = composeTemplatesModule(
        deps.api,
        deps.namespace,
      );
      const { isOwnedAgent } = composeAgentsModule({
        api: deps.api,
        namespace: deps.namespace,
        owner,
        db: deps.db,
        userDirectory,
        channelSecretStore: deps.channelSecretStore,
        readTemplateSpec,
      });
      const { isOwnedSchedule } = composeSchedulesModule(
        deps.api,
        deps.namespace,
        owner,
      );
      const { sessions } = composeSessionsModule({
        db: deps.db,
        namespace: deps.namespace,
        isOwnedAgent,
        isOwnedSchedule,
      });

      let resumeSessionId: string | undefined;
      if (sessionMode === "continuous") {
        const found = await sessions.findByScheduleId(scheduleId);
        resumeSessionId = found?.sessionId;
      }

      const acp = createAcpClient({
        namespace: deps.namespace,
        instanceName: agentId,
      });

      // Always cast `schedule_cron` — the sessions module currently widens
      // to a free string for the schedule-firing path; tightening lives in
      // a follow-up.
      const sessionType = "schedule_cron" as Parameters<
        typeof sessions.create
      >[3];

      return acp.triggerSession(
        resumeSessionId
          ? { prompt: task, mcpServers, resumeSessionId }
          : {
              prompt: task,
              mcpServers,
              onSessionCreated: (sid: string) =>
                sessions.create(
                  sid,
                  agentId,
                  SessionMode.Chat,
                  sessionType,
                  scheduleId,
                ),
            },
      );
    },
  };
}
