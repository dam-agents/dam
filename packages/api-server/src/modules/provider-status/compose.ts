import type { Redis } from "ioredis";
import type { Subscription } from "rxjs";
import type { ProviderStatusService } from "api-server-api";
import { createRedisCallWindow } from "./infrastructure/redis-call-window.js";
import { createRedisStatusSnapshots } from "./infrastructure/redis-status-snapshot.js";
import { startCountGatewayCallsSaga } from "./sagas/count-gateway-calls.js";
import {
  createProviderStatusService,
  type ProviderStatusEvaluator,
} from "./services/provider-status-service.js";

export interface ProviderStatusModule {
  service: ProviderStatusService & ProviderStatusEvaluator;
  startSaga(): Subscription;
}

export function composeProviderStatus(deps: {
  redis: Redis;
}): ProviderStatusModule {
  const window = createRedisCallWindow(deps.redis);
  return {
    service: createProviderStatusService({
      window,
      snapshots: createRedisStatusSnapshots(deps.redis),
    }),
    startSaga: () => startCountGatewayCallsSaga({ window }),
  };
}
