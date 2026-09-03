import { harnessT } from "./harness-trpc.js";
import { artifactLibraryHarnessRouter } from "./modules/artifact-library/harness-router.js";
import { kbPublishHarnessRouter } from "./modules/kb-publish/harness-router.js";
import { harnessRuntimeRouter } from "./modules/runtime/harness-router.js";

export const harnessRouter = harnessT.router({
  artifactLibrary: artifactLibraryHarnessRouter,
  kbPublish: kbPublishHarnessRouter,
  runtime: harnessRuntimeRouter,
});

export type HarnessRouter = typeof harnessRouter;
