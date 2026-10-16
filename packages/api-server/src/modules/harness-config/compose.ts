import type { Db } from "db";
import type {
  HarnessCatalog,
  HarnessConfigService,
  SessionPair,
} from "api-server-api";
import {
  createHarnessConfigService,
  resolveFirePair,
  harnessesOf,
} from "./services/harness-config-service.js";
import { createSessionPairRepo } from "./infrastructure/session-pair-repo.js";
import {
  createSessionChoicesValidator,
  type SessionChoicesValidator,
} from "./services/session-choices.js";
import { createHarnessConfigSnapshotRepo } from "./infrastructure/snapshot-repo.js";
import { createRuntimeCatalogReader } from "./infrastructure/runtime-catalog.js";
import { startConvertDefaultOnHelloSaga } from "./sagas/convert-default-on-hello.js";
import {
  createDefaultConverter,
  type DefaultConverter,
  type WakeStamp,
} from "./services/default-conversion.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeHarnessConfigModule(deps: {
  db: Db;
  surface: string;
  runtimeMutator: RuntimeMutator;
  catalog: HarnessCatalog;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  isSettled: (agentId: string) => Promise<boolean>;
}): { service: HarnessConfigService } {
  const { db, ...serviceDeps } = deps;
  return {
    service: createHarnessConfigService({
      ...serviceDeps,
      snapshotRepo: createHarnessConfigSnapshotRepo(db),
      pairRepo: createSessionPairRepo(db),
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
  return (agentId, preferred) => resolveFirePair(resolver, agentId, preferred);
}

export function composeDefaultConverter(deps: {
  db: Db;
  namespace: string;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  modelsRanBy?: (agentId: string, hours: number) => Promise<string[]>;
  movedToNewImage: (agentId: string) => Promise<boolean>;
  isRunning: (agentId: string) => Promise<boolean>;
  wake: (agentId: string) => Promise<WakeStamp | null>;
  lastHelloAt: (agentId: string) => Promise<number | null>;
  log: (msg: string) => void;
}): DefaultConverter {
  const { db, namespace, ...rest } = deps;
  const converter = createDefaultConverter({
    ...rest,
    pairRepo: createSessionPairRepo(db),
    snapshotRepo: createHarnessConfigSnapshotRepo(db),
    catalogView: createRuntimeCatalogReader(namespace),
  });
  startConvertDefaultOnHelloSaga(converter);
  return converter;
}
