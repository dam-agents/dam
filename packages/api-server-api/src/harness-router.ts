import { harnessT } from "./harness-trpc.js";
import { harnessRuntimeRouter } from "./modules/runtime/harness-router.js";

/**
 * Top-level harness API tRPC router (ADR-022, ADR-052). Mounted on the
 * harness API server (`harness-api-server` app) which the agent reaches
 * through its paired gateway pod (Envoy). The user-facing `appRouter` and
 * this `harnessRouter` share neither context nor surface.
 */
export const harnessRouter = harnessT.router({
  runtime: harnessRuntimeRouter,
});

export type HarnessRouter = typeof harnessRouter;
