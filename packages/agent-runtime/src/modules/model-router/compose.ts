import type { IncomingMessage } from "node:http";
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
import {
  sessionOf,
  sessionOfRunningTurn,
  sessionStampOf,
  subagentSessionOf,
} from "./domain/session-of.js";
import type { CallerSessionLookup } from "./infrastructure/caller-session.js";
import { createCatalogEndpoints } from "./services/catalog-endpoints.js";
import {
  createModelRouter,
  type ModelCallRecord,
  type ModelRefusal,
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
  runningSessionsOf?: (harness: string) => string[];
  callerSessions?: CallerSessionLookup;
  onCall?: (record: ModelCallRecord) => void;
  onCallStarted?: (session: string | null) => void;
  onCallEnded?: (session: string | null, answered: boolean) => void;
  onRefused?: (refusal: ModelRefusal) => void;
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
  const knownSessionOf = (id: string): string | null =>
    !opts.isSession || opts.isSession(id)
      ? id
      : (opts.terminalSessionOf?.(id) ?? null);
  const guessed = new WeakSet<IncomingMessage>();
  /**
   * UNIT_BOUNDARY_DESCRIPTION: the Session a call's spend is booked to, which
   * only stamps the call and its record and never picks its model. A call
   * whose own marker names a Session books there. A call with no marker, one
   * routed by the running-turn guess, or one carrying the id of a run that is
   * no Session, such as `claude -p` or an SDK script started from a
   * Session's shell, books to the Session its process inherited. Anything
   * else stays as it was routed.
   */
  const bookedSessionOf = async (call: {
    req: IncomingMessage;
    harness: string;
    routed: string | null;
  }): Promise<string | null> => {
    const { routed } = call;
    if (
      routed !== null &&
      knownSessionOf(routed) === routed &&
      !guessed.has(call.req)
    )
      return routed;
    const inherited = opts.callerSessions
      ? await opts.callerSessions.sessionOf(call.req.socket, knownSessionOf)
      : null;
    return inherited ?? routed;
  };
  return createModelRouter({
    catalog: opts.catalog,
    envState: opts.envState,
    harnesses: opts.harnesses,
    defaultHarness: opts.defaultHarness,
    sessionOf: (req, body, harness) => {
      const marked = sessionOf(req, body);
      const found =
        marked ??
        sessionOfRunningTurn(
          opts.harnesses[harness],
          opts.runningSessionsOf?.(harness) ?? [],
        );
      if (!found) return null;
      if (!marked) guessed.add(req);
      const stamp = sessionStampOf(req);
      const parent = subagentSessionOf(
        found,
        (id) => !opts.isSession || opts.isSession(id),
      );
      return parent !== undefined
        ? {
            sessionId: found.sessionId,
            parentSessionId: platformSessionOf(parent, stamp),
          }
        : { sessionId: platformSessionOf(found.sessionId, stamp) };
    },
    bookedSessionOf,
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
    ...(opts.onCallStarted && { onCallStarted: opts.onCallStarted }),
    ...(opts.onCallEnded && { onCallEnded: opts.onCallEnded }),
    ...(opts.onRefused && { onRefused: opts.onRefused }),
    ...(opts.port !== undefined && { port: opts.port }),
    log: opts.log,
  });
}
