import { t } from "./trpc.js";
import { artifactApiRouter } from "./modules/artifact-api/router.js";
import { browserRouter } from "./modules/browser/router.js";
import { filesRouter } from "./modules/files/router.js";
import { kbPublishRouter } from "./modules/kb-publish/router.js";
import { sessionsRouter } from "./modules/sessions/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { sshRouter } from "./modules/ssh/router.js";
import { runtimeRouter } from "./modules/runtime/router.js";
import { harnessConfigRouter } from "./modules/harness-config/router.js";
import { processesRouter } from "./modules/processes/router.js";

export const appRouter = t.router({
  artifactApi: artifactApiRouter,
  browser: browserRouter,
  files: filesRouter,
  kbPublish: kbPublishRouter,
  sessions: sessionsRouter,
  skills: skillsRouter,
  ssh: sshRouter,
  runtime: runtimeRouter,
  harnessConfig: harnessConfigRouter,
  processes: processesRouter,
});

export type AppRouter = typeof appRouter;
