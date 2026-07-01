import { t } from "./trpc.js";
import { filesRouter } from "./modules/files/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { sshRouter } from "./modules/ssh/router.js";
import { runtimeRouter } from "./modules/runtime/router.js";
import { harnessConfigRouter } from "./modules/harness-config/router.js";

export const appRouter = t.router({
  files: filesRouter,
  skills: skillsRouter,
  ssh: sshRouter,
  runtime: runtimeRouter,
  harnessConfig: harnessConfigRouter,
});

export type AppRouter = typeof appRouter;
