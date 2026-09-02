import { harnessT } from "./harness-trpc.js";
import { harnessRuntimeRouter } from "./modules/runtime/harness-router.js";
import { harnessSessionDirectoryRouter } from "./modules/session-directory/harness-router.js";

export const harnessRouter = harnessT.router({
  runtime: harnessRuntimeRouter,
  sessionDirectory: harnessSessionDirectoryRouter,
});

export type HarnessRouter = typeof harnessRouter;
