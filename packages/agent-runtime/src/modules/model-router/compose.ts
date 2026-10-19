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
import { sessionOf, sessionStampOf } from "./domain/session-of.js";
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
  isSession?: (sessionId: string) => boolean;
  terminalSessionOf?: (harnessSessionId: string) => string | undefined;
  onCall?: (record: ModelCallRecord) => void;
  port?: number;
  log: (msg: string) => void;
}

export function composeModelRouter(opts: ComposeModelRouterOpts): ModelRouter {
  /**
   * UNIT_BOUNDARY_DESCRIPTION: a Codex or Bob terminal runs under the
   * harness's own id, so an id that is no Session of the runtime is looked up
   * in the terminal pins. A Codex terminal also stamps the platform's id
   * itself, which covers a thread with no pin, such as its title thread; with
   * neither the harness's id stands.
   */
  const platformSessionOf = (id: string, stamp: string | null): string =>
    !opts.isSession || opts.isSession(id)
      ? id
      : (opts.terminalSessionOf?.(id) ?? stamp ?? id);
  return createModelRouter({
    catalog: opts.catalog,
    envState: opts.envState,
    harnesses: opts.harnesses,
    defaultHarness: opts.defaultHarness,
    sessionOf: (req, body) => {
      const found = sessionOf(req, body);
      if (!found) return null;
      const stamp = sessionStampOf(req);
      return found.parentSessionId
        ? {
            ...found,
            parentSessionId: platformSessionOf(found.parentSessionId, stamp),
          }
        : { sessionId: platformSessionOf(found.sessionId, stamp) };
    },
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
