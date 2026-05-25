import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import type {
  RuntimeDeliveryService,
  TriggerEventHandler,
} from "api-server-api";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { composeSchedulesModule } from "../../modules/schedules/index.js";
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
  // ADR-052: agent-callable runtime channel routes.
  runtimeHello: RuntimeDeliveryService;
  triggerEventHandler: TriggerEventHandler;
  // ADR-053: controller schedule-fired hook.
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
    triggerEventHandler,
    runtimeMutator,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);

  const app = createHarnessRouter({
    channelManager,
    k8s: k8sClient,
    agentHome: config.agentHome,
    runtimeHello,
    triggerEventHandler,
    db,
    runtimeMutator,
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
