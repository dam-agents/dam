import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import type {
  AgentsService,
  ConnectionsService,
  RuntimeDeliveryService,
} from "api-server-api";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { EXPERIMENT_ACTIVE_KEY } from "../../modules/agents/infrastructure/labels.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import { composeArtifactLibraryForOwner } from "../../modules/artifact-library/index.js";
import { composeExperimentsForOwner } from "../../modules/experiments/index.js";
import { composeInvocationsForOwner } from "../../modules/invocations/index.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import { createTemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import { composeTemplatesModule } from "../../modules/templates/compose.js";
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
  artifacts: ArtifactService;
  /** Owner-scoped agents service, for spawning Invocation target agents. */
  agentsServiceFor: (owner: string) => AgentsService;
  /** Owner-scoped connections service, for the driver's grants + attenuation. */
  connectionsServiceFor: (owner: string) => ConnectionsService;
  /** Scale a hibernated agent back up so it drains its outbox (prompt delivery). */
  wakeAgent: (agentId: string) => Promise<void>;
  /** Whether the pod has applied everything the outbox holds — gates the skills
   *  `state` reconcile, which would otherwise reap rows mid-apply. */
  isRuntimeSettled: (agentId: string) => Promise<boolean>;
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
    artifacts,
    agentsServiceFor,
    connectionsServiceFor,
    wakeAgent,
    isRuntimeSettled,
  } = deps;

  const k8sClient = createK8sClient(api, config.namespace);
  // Boot-loaded, file-mounted templates, shared across requests.
  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);
  const { templates } = composeTemplatesModule(templatesRepo);

  const invocationsServiceFor = (owner: string) =>
    composeInvocationsForOwner({
      db,
      owner,
      agents: agentsServiceFor(owner),
      runtimeMutator,
      wakeAgent,
    });

  const artifactLibraryFor = (owner: string) =>
    composeArtifactLibraryForOwner({
      db,
      artifacts,
      owner,
      shareBaseUrl: config.shareBaseUrl,
    }).artifactLibrary;

  // Pin port for the REST-side experiment finish path (a script's own
  // completion must release the driver's hibernation pin).
  const harnessAgentsRepo = createAgentsRepository(k8sClient);
  const experimentPin = {
    set: (agentId: string) =>
      harnessAgentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, "true"),
    clear: (agentId: string) =>
      harnessAgentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, ""),
  };

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
        isRuntimeSettled,
      ),
    schedulesServiceFor: (owner) =>
      composeSchedulesForOwner({ boot: schedulesBoot, owner }).schedules,
    experimentsServiceFor: (owner) =>
      composeExperimentsForOwner({
        db,
        owner,
        artifactLibrary: artifactLibraryFor(owner),
        pin: experimentPin,
      }).experiments,
    artifactLibraryFor,
    invocationsServiceFor,
    connectionsServiceFor,
    templates,
  });

  const server = serve(
    { fetch: app.fetch, port: config.harnessServerPort },
    () => {
      process.stderr.write(
        `harness-api listening on http://localhost:${config.harnessServerPort}\n`,
      );
    },
  );

  // No WebSocket routes remain on the harness port; refuse upgrades.
  server.on("upgrade", (_req, socket) => {
    socket.destroy();
  });

  return { server };
}
