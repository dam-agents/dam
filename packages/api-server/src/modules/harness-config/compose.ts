import type { Subscription } from "rxjs";
import type { Db } from "db";
import type {
  DefaultKind,
  DefaultModelNotice,
  HarnessCatalog,
  HarnessConfigService,
  SessionPair,
} from "api-server-api";
import {
  createHarnessConfigService,
  resolveFirePair,
  harnessesOf,
} from "./services/harness-config-service.js";
import { NoDefaultModelError } from "./domain/no-default-model.js";
import { createSessionPairRepo } from "./infrastructure/session-pair-repo.js";
import {
  createSessionChoicesValidator,
  type SessionChoicesValidator,
} from "./services/session-choices.js";
import { createHarnessConfigSnapshotRepo } from "./infrastructure/snapshot-repo.js";
import { createRuntimeCatalogReader } from "./infrastructure/runtime-catalog.js";
import { createScheduleModelForFire } from "./services/schedule-model.js";
import { startConvertDefaultOnHelloSaga } from "./sagas/convert-default-on-hello.js";
import { startPublishDefaultsOnHelloSaga } from "./sagas/publish-defaults-on-hello.js";
import { createSessionDefaultsPublisher } from "./services/session-defaults-publisher.js";
import {
  createDefaultConverter,
  type DefaultConverter,
  type WakeStamp,
} from "./services/default-conversion.js";
import { createHarnessConfigResetRepo } from "./infrastructure/reset-repo.js";
import { createHarnessConfigReset } from "./services/harness-config-reset.js";
import { createHarnessConfigEventQueue } from "./infrastructure/config-event-queue.js";
import type { OutboxRepo } from "../runtime-delivery/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { emit, EventType } from "../../events.js";
import { createDefaultModelNoticeReader } from "./infrastructure/default-model-notices.js";
import {
  createUnattendedAgentsReader,
  type UnattendedAgent,
} from "./infrastructure/unattended-agents.js";
import { createInitializationPairResolver } from "./services/initialization-pair.js";

export const ETE_BYPASS_RESET = {
  reset: "ibm-litellm-bypass-mode",
  template: "ibm-litellm",
  harness: "claude-code",
  from: "bypassPermissions",
  to: "auto",
} as const;

export function composeHarnessConfigReset(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  runtimeMutator: RuntimeMutator;
  ownerOf: (agentId: string) => Promise<string | null>;
  log: (msg: string) => void;
}): { run(): Promise<{ reset: number; failed: number }> } {
  return createHarnessConfigReset({
    repo: createHarnessConfigResetRepo({
      db: deps.db,
      ...ETE_BYPASS_RESET,
    }),
    snapshotRepo: createHarnessConfigSnapshotRepo(deps.db),
    eventQueue: createHarnessConfigEventQueue({
      db: deps.db,
      outboxRepo: deps.outboxRepo,
    }),
    enqueue: (agentId) => deps.runtimeMutator.enqueueAfterCommit(agentId),
    ownerOf: deps.ownerOf,
    harness: ETE_BYPASS_RESET.harness,
    from: ETE_BYPASS_RESET.from,
    to: ETE_BYPASS_RESET.to,
    log: deps.log,
  });
}

export function composeHarnessConfigModule(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  surface: string;
  runtimeMutator: RuntimeMutator;
  catalog: HarnessCatalog;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  isSettled: (agentId: string) => Promise<boolean>;
}): { service: HarnessConfigService } {
  const { db, outboxRepo, ...serviceDeps } = deps;
  const resetRepo = createHarnessConfigResetRepo({ db, ...ETE_BYPASS_RESET });
  const pairRepo = createSessionPairRepo(db);
  return {
    service: createHarnessConfigService({
      ...serviceDeps,
      snapshotRepo: createHarnessConfigSnapshotRepo(db),
      pairRepo,
      eventQueue: createHarnessConfigEventQueue({ db, outboxRepo }),
      retireReset: (agentId, tx, harness) =>
        resetRepo.retire(agentId, tx, harness),
      publishDefaults: createSessionDefaultsPublisher({
        db,
        pairRepo,
        runtimeMutator: deps.runtimeMutator,
      }),
    }),
  };
}

export function composeSessionChoicesValidator(deps: {
  db: Db;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  firePair: FirePair;
}): SessionChoicesValidator {
  return createSessionChoicesValidator({
    catalog: deps.catalog,
    pairRepo: createSessionPairRepo(deps.db),
    snapshotRepo: createHarnessConfigSnapshotRepo(deps.db),
    getCapabilities: deps.getCapabilities,
    firePair: deps.firePair,
  });
}

export type FirePair = (
  agentId: string,
  kind: DefaultKind,
  preferred: { harness?: string; provider?: string; model?: string },
) => Promise<SessionPair | null | undefined>;

export function composeFirePair(deps: {
  db: Db;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
}): FirePair {
  const resolver = {
    ...deps,
    pairRepo: createSessionPairRepo(deps.db),
  };
  return (agentId, kind, preferred) =>
    resolveFirePair(resolver, agentId, kind, preferred);
}

export function composeInitializationPairResolver(deps: {
  firePair: (
    agentId: string,
    preferred: { harness?: string },
  ) => Promise<SessionPair | null | undefined>;
  log: (msg: string) => void;
}): ReturnType<typeof createInitializationPairResolver> {
  return createInitializationPairResolver(deps);
}

export function composeDefaultConverter(deps: {
  db: Db;
  namespace: string;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  modelsRanBy: (agentId: string, hours: number) => Promise<string[]>;
  movedToNewImage: (agentId: string) => Promise<boolean>;
  isRunning: (agentId: string) => Promise<boolean>;
  wake: (agentId: string) => Promise<WakeStamp | null>;
  lastHelloAt: (agentId: string) => Promise<number | null>;
  ownerOf: (agentId: string) => Promise<string | undefined>;
  runtimeMutator: RuntimeMutator;
  log: (msg: string) => void;
}): { converter: DefaultConverter; helloSaga: Subscription } {
  const { db, namespace, ownerOf, runtimeMutator, ...rest } = deps;
  const pairRepo = createSessionPairRepo(db);
  const publishDefaults = createSessionDefaultsPublisher({
    db,
    pairRepo,
    runtimeMutator,
  });
  const converter = createDefaultConverter({
    ...rest,
    onSaved: (agentId) => {
      void publishDefaults(agentId).catch((err: Error) =>
        deps.log(
          `[default-conversion] ${agentId}: sending the defaults failed: ${err.message}`,
        ),
      );
      void ownerOf(agentId)
        .then((ownerSub) => {
          if (!ownerSub) return;
          emit({ type: EventType.HarnessConfigChanged, ownerSub, agentId });
          emit({ type: EventType.AttentionChanged, ownerSub, agentId });
        })
        .catch((err: Error) =>
          deps.log(
            `[default-conversion] ${agentId}: notify failed: ${err.message}`,
          ),
        );
    },
    pairRepo,
    snapshotRepo: createHarnessConfigSnapshotRepo(db),
    catalogView: createRuntimeCatalogReader(namespace),
  });
  const helloSaga = startConvertDefaultOnHelloSaga(converter);
  helloSaga.add(startPublishDefaultsOnHelloSaga(publishDefaults));
  return { converter, helloSaga };
}

export function composeConvertingFirePair(
  converter: DefaultConverter,
  firePair: FirePair,
): (
  agentId: string,
  kind: DefaultKind,
) => Promise<SessionPair | null | undefined> {
  return async (agentId, kind) => {
    const outcome = await converter.convert(agentId);
    try {
      return await firePair(agentId, kind, {});
    } catch (err) {
      if (err instanceof NoDefaultModelError && outcome === "waiting")
        throw new NoDefaultModelError(undefined, { pending: true });
      throw err;
    }
  };
}

export function composeScheduleModelForFire(deps: {
  db: Db;
  getCapabilities: (agentId: string) => Promise<unknown>;
}): (agentId: string, model: string) => Promise<string | undefined> {
  return createScheduleModelForFire({
    getCapabilities: deps.getCapabilities,
    snapshotRepo: createHarnessConfigSnapshotRepo(deps.db),
  });
}

export function composeUnattendedAgentsReader(
  db: Db,
): (templateId: string) => Promise<UnattendedAgent[]> {
  return createUnattendedAgentsReader(db);
}

export function composeDefaultModelNotices(
  db: Db,
): (agentIds: readonly string[]) => Promise<DefaultModelNotice[]> {
  return createDefaultModelNoticeReader(db);
}
