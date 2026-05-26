import { harnessT } from "./harness-trpc.js";
import { harnessRuntimeRouter } from "./modules/runtime/harness-router.js";

export const harnessRouter = harnessT.router({
  runtime: harnessRuntimeRouter,
});

export type HarnessRouter = typeof harnessRouter;
