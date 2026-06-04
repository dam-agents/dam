import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import type { RuntimeDeliveryService } from "api-server-api";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { createHarnessRouter } from "./harness-router.js";
import type { Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

export interface HarnessApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  seedSources: SkillSourceSeed[];
  runtimeHello: RuntimeDeliveryService;
  schedulesBoot: SchedulesBoot;
  runtimeMutator: RuntimeMutator;
}

export function startHarnessApiServerApp(deps: HarnessApiServerAppDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    seedSources,
    runtimeHello,
    schedulesBoot,
    runtimeMutator,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);

  const app = createHarnessRouter({
    channelManager,
    k8s: k8sClient,
    agentHome: config.agentHome,
    runtimeHello,
    composeSkills: (owner) =>
      composeSkillsModule(
        api,
        config.namespace,
        owner,
        db,
        seedSources,
        config.brand.name,
        runtimeMutator,
      ),
    schedulesServiceFor: (owner) =>
      composeSchedulesForOwner({ boot: schedulesBoot, owner }).schedules,
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
