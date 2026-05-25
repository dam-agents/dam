import { t } from "./trpc.js";
import { filesRouter } from "./modules/files/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { runtimeRouter } from "./modules/runtime/router.js";

export const appRouter = t.router({
  files: filesRouter,
  skills: skillsRouter,
  runtime: runtimeRouter,
});

export type AppRouter = typeof appRouter;
