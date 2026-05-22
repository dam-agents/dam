import { t } from "./trpc.js";
import { filesRouter } from "./modules/files/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { runtimeChannelRouter } from "./modules/runtime-channel/router.js";

export const appRouter = t.router({
  files: filesRouter,
  skills: skillsRouter,
  runtimeChannel: runtimeChannelRouter,
});

export type AppRouter = typeof appRouter;
