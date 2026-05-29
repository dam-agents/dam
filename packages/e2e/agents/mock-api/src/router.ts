import { t } from "./trpc.js";
import { scriptedMockRouter } from "./modules/scripted-mock/router.js";

export const appRouter = t.router({
  scriptedMock: scriptedMockRouter,
});

export type AppRouter = typeof appRouter;
