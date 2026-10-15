import type { ModelCatalog } from "../model-catalog/index.js";
import type { ModelRouterBinding } from "../runtime-channel/manifest.js";
import type { RuntimeEnvState } from "../runtime-channel/infrastructure/env-state-store.js";
import {
  applyReplayRules,
  dropUnsupportedReasoning,
  ensureStreamUsage,
  fitOutputBudget,
  floorOutputBudget,
} from "./domain/replay.js";
import { sessionOf } from "./domain/session-of.js";
import { createCatalogEndpoints } from "./services/catalog-endpoints.js";
import {
  createModelRouter,
  type ModelCallRecord,
  type ModelRouter,
  type SessionModelChoice,
} from "./services/model-router.js";

export interface ComposeModelRouterOpts {
  catalog: Pick<ModelCatalog, "providers" | "forHarness">;
  envState: () => RuntimeEnvState;
  harnesses: Readonly<Record<string, ModelRouterBinding | undefined>>;
  defaultHarness: string;
  sessionModelOf?: (sessionId: string) => SessionModelChoice | null;
  onCall?: (record: ModelCallRecord) => void;
  port?: number;
  log: (msg: string) => void;
}

export function composeModelRouter(opts: ComposeModelRouterOpts): ModelRouter {
  return createModelRouter({
    catalog: opts.catalog,
    envState: opts.envState,
    harnesses: opts.harnesses,
    defaultHarness: opts.defaultHarness,
    sessionOf: (req, body) => sessionOf(req, body),
    ...(opts.sessionModelOf && { sessionModelOf: opts.sessionModelOf }),
    prepareBody: (body, { entry, dialect }) =>
      ensureStreamUsage(
        dropUnsupportedReasoning(
          fitOutputBudget(
            floorOutputBudget(
              applyReplayRules(body, {
                dialect,
                alias: entry.alias,
                upstreamId: entry.upstreamId,
              }),
              { dialect, upstreamId: entry.upstreamId },
            ),
            {
              dialect,
              alias: entry.alias,
              maxOutputTokens: entry.metadata.maxOutputTokens,
            },
          ),
          { dialect, reasoning: entry.metadata.reasoning },
        ),
        dialect,
      ),
    extensions: [createCatalogEndpoints(opts.catalog)],
    ...(opts.onCall && { onCall: opts.onCall }),
    ...(opts.port !== undefined && { port: opts.port }),
    log: opts.log,
  });
}
