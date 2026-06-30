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
import { createTemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { createHarnessRouter } from "./harness-router.js";
import { createRunRelay } from "./harness-run-relay.js";
import { createRunsService } from "../../modules/runs/services/runs-service.js";
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
  // Boot-loaded, file-mounted templates, shared across requests.
  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);

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
        templatesRepo,
      ),
    schedulesServiceFor: (owner) =>
      composeSchedulesForOwner({ boot: schedulesBoot, owner }).schedules,
  });

  // `dam-run` executor streams: the agent dials /api/agents/<id>/run over the
  // harness port; we materialise an ephemeral Run pod and relay its /api/exec
  // stdio. WebSocket upgrades on the harness port are wired manually (the Hono
  // node server doesn't handle them).
  const runs = createRunsService(k8sClient);
  const runRelay = createRunRelay({
    k8s: k8sClient,
    runs,
  });

  const server = serve(
    { fetch: app.fetch, port: config.harnessServerPort },
    () => {
      process.stderr.write(
        `harness-api listening on http://localhost:${config.harnessServerPort}\n`,
      );
    },
  );

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    const m = url.pathname.match(/^\/api\/agents\/([^/]+)\/run$/);
    if (!m) {
      socket.destroy();
      return;
    }
    runRelay.handleUpgrade(req, socket, head, decodeURIComponent(m[1]!));
  });

  // A fresh harness process holds no live relays, so any Run CR that survived a
  // crash is leaked — its executor pod would run untethered. Sweep them.
  void runs
    .listRunIds()
    .then(async (ids) => {
      await Promise.all(ids.map((id) => runs.delete(id)));
      if (ids.length > 0) {
        process.stderr.write(
          `harness-api swept ${ids.length} orphaned run(s)\n`,
        );
      }
    })
    .catch(() => {});

  return { server };
}
