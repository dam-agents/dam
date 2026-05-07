import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import { SessionMode } from "api-server-api";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";
import {
  composeInstancesModule, createKeycloakUserDirectory,
} from "../../modules/instances/index.js";
import { composeAgentsModule } from "../../modules/agents/index.js";
import { composeTemplatesModule } from "../../modules/templates/index.js";
import { composeSchedulesModule } from "../../modules/schedules/index.js";
import { composeSessionsModule } from "../../modules/sessions/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { createAcpClient } from "../../core/acp-client.js";
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
    composeSkills: (owner) => composeSkillsModule(api, config.namespace, owner, db, seedSources, config.brand.name),
    schedulesServiceFor: (owner) =>
      composeSchedulesModule(api, config.namespace, owner).schedules,
    handleTrigger: async (body) => {
      const mode = body.sessionMode ?? "fresh";
      const sessionType = "schedule_cron";

      // Look up the instance's real owner from its ConfigMap. Composing
      // with "_system" would short-circuit sessions.create's isOwnedInstance
      // check and silently drop the DB row — so the scheduled session would
      // fire, complete, and leave no trace in the sessions table.
      const instanceCm = await k8sClient.getConfigMap(body.instanceId);
      const owner = instanceCm?.metadata?.labels?.[LABEL_OWNER];
      if (!owner) {
        throw new Error(`instance ${body.instanceId}: missing owner label`);
      }
      const { readSpec: readTemplateSpec } = composeTemplatesModule(api, config.namespace);
      const { agents } = composeAgentsModule({
        api, namespace: config.namespace, owner, agentHome: config.agentHome, readTemplateSpec,
      });
      const { isOwnedInstance } = composeInstancesModule({
        api, namespace: config.namespace, owner, db, userDirectory, channelSecretStore,
        getAgent: (id) => agents.get(id),
      });
      const { isOwnedSchedule } = composeSchedulesModule(api, config.namespace, owner);
      const { sessions } = composeSessionsModule({
        db, namespace: config.namespace, isOwnedInstance, isOwnedSchedule,
      });

      let resumeSessionId: string | undefined;
      if (mode === "continuous") {
        const found = await sessions.findByScheduleId(body.schedule);
        resumeSessionId = found?.sessionId;
      }

      const acp = createAcpClient({
        namespace: config.namespace,
        instanceName: body.instanceId,
        onSessionCreated: (sid: string) => sessions.create(sid, body.instanceId, SessionMode.Chat, sessionType as any, body.schedule),
      });

      return acp.triggerSession({
        prompt: body.task,
        resumeSessionId,
        mcpServers: body.mcpServers,
      });
    },
  });

  const server = serve({ fetch: app.fetch, port: config.harnessServerPort }, () => {
    process.stderr.write(`harness-api listening on http://localhost:${config.harnessServerPort}\n`);
  });

  return { server };
}
