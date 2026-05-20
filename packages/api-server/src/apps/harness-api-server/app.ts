import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import { SessionMode } from "api-server-api";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";
import {
  composeAgentsModule,
  createKeycloakUserDirectory,
} from "../../modules/agents/index.js";
import { composeTemplatesModule } from "../../modules/templates/index.js";
import { composeSchedulesModule } from "../../modules/schedules/index.js";
import { composeSessionsModule } from "../../modules/sessions/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { SessionType } from "api-server-api";
import { createAcpClient } from "../../core/acp-client.js";
import { emit, EventType, type TurnOutcome } from "../../events.js";
import { createHarnessRouter } from "./harness-router.js";
import type { Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { ChannelSecretStore } from "./../../modules/channels/infrastructure/channel-secret-store.js";
import type { PodFilesBus } from "../../modules/pod-files/bus.js";
import type { FileSpec } from "../../modules/pod-files/types.js";

export interface HarnessApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  channelSecretStore: ChannelSecretStore;
  podFilesBus: PodFilesBus;
  podFilesSnapshot: (owner: string, agentId: string) => Promise<FileSpec[]>;
  seedSources: SkillSourceSeed[];
}

export function startHarnessApiServerApp(deps: HarnessApiServerAppDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    channelSecretStore,
    podFilesBus,
    podFilesSnapshot,
    seedSources,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);

  const userDirectory = createKeycloakUserDirectory({
    keycloakUrl: config.keycloakUrl,
    keycloakRealm: config.keycloakRealm,
    clientId: config.keycloakApiClientId,
    clientSecret: config.keycloakApiClientSecret,
  });

  const app = createHarnessRouter({
    channelManager,
    k8s: k8sClient,
    podFiles: { bus: podFilesBus, fetchSnapshot: podFilesSnapshot },
    agentHome: config.agentHome,
    composeSkills: (owner) =>
      composeSkillsModule(
        api,
        config.namespace,
        owner,
        db,
        seedSources,
        config.brand.name,
      ),
    schedulesServiceFor: (owner) =>
      composeSchedulesModule(api, config.namespace, owner).schedules,
    handleTrigger: async (body) => {
      const mode = body.sessionMode ?? "fresh";

      // Look up the instance's real owner from its ConfigMap. Composing
      // with "_system" would short-circuit sessions.create's isOwnedAgent
      // check and silently drop the DB row — so the scheduled session would
      // fire, complete, and leave no trace in the sessions table.
      const agentCm = await k8sClient.getConfigMap(body.agentId);
      const owner = agentCm?.metadata?.labels?.[LABEL_OWNER];
      if (!owner) {
        throw new Error(`agent ${body.agentId}: missing owner label`);
      }
      const { readSpec: readTemplateSpec } = composeTemplatesModule(
        api,
        config.namespace,
      );
      const { isOwnedAgent } = composeAgentsModule({
        api,
        namespace: config.namespace,
        owner,
        db,
        userDirectory,
        channelSecretStore,
        readTemplateSpec,
      });
      const { isOwnedSchedule } = composeSchedulesModule(
        api,
        config.namespace,
        owner,
      );
      const { sessions } = composeSessionsModule({
        db,
        namespace: config.namespace,
        isOwnedAgent,
        isOwnedSchedule,
      });

      let resumeSessionId: string | undefined;
      if (mode === "continuous") {
        const found = await sessions.findByScheduleId(body.schedule);
        resumeSessionId = found?.sessionId;
      }

      const acp = createAcpClient({
        namespace: config.namespace,
        instanceName: body.agentId,
      });

      let sessionId: string | null = resumeSessionId ?? null;
      let outcome: TurnOutcome = "failure";
      try {
        const result = await acp.triggerSession(
          resumeSessionId
            ? {
                prompt: body.task,
                mcpServers: body.mcpServers,
                resumeSessionId,
              }
            : {
                prompt: body.task,
                mcpServers: body.mcpServers,
                // Capture sessionId here so the ScheduleFired event reflects
                // the real session even when the ACP call throws after the
                // session row has already been created.
                onSessionCreated: (sid) => {
                  sessionId = sid;
                  return sessions.create(
                    sid,
                    body.agentId,
                    SessionMode.Chat,
                    SessionType.ScheduleCron,
                    body.schedule,
                  );
                },
              },
        );
        sessionId = result.sessionId;
        outcome = "success";
        return result;
      } finally {
        emit({
          type: EventType.ScheduleFired,
          scheduleId: body.schedule,
          agentId: body.agentId,
          ownerSub: owner,
          mode,
          sessionId,
          outcome,
        });
      }
    },
  });

  const server = serve(
    { fetch: app.fetch, port: config.harnessServerPort },
    () => {
      process.stderr.write(
        `harness-api listening on http://localhost:${config.harnessServerPort}\n`,
      );
    },
  );

  return { server };
}
