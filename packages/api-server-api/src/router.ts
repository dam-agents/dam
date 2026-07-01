import { t } from "./trpc.js";
import { agentsRouter } from "./modules/agents/router.js";
import { apiKeysRouter } from "./modules/api-keys/router.js";
import { approvalsRouter } from "./modules/approvals/router.js";
import { channelsRouter } from "./modules/channels/router.js";
import { connectionsRouter } from "./modules/connections/router.js";
import { e2eRouter } from "./modules/e2e/router.js";
import { egressRulesRouter } from "./modules/egress-rules/router.js";
import { filesRouter } from "./modules/files/router.js";
import { schedulesRouter } from "./modules/schedules/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { reposRouter } from "./modules/repos/router.js";
import { templatesRouter } from "./modules/templates/router.js";
import { termsRouter } from "./modules/terms/router.js";

export const appRouter = t.router({
  templates: templatesRouter,
  repos: reposRouter,
  agents: agentsRouter,
  schedules: schedulesRouter,
  channels: channelsRouter,
  connections: connectionsRouter,
  skills: skillsRouter,
  approvals: approvalsRouter,
  egressRules: egressRulesRouter,
  files: filesRouter,
  terms: termsRouter,
  e2e: e2eRouter,
  apiKeys: apiKeysRouter,
});

export type AppRouter = typeof appRouter;
