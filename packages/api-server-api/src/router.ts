import { t } from "./trpc.js";
import { agentsRouter } from "./modules/agents/router.js";
import { approvalsRouter } from "./modules/approvals/router.js";
import { channelsRouter } from "./modules/channels/router.js";
import { connectionsRouter } from "./modules/connections/router.js";
import { egressRulesRouter } from "./modules/egress-rules/router.js";
import { schedulesRouter } from "./modules/schedules/router.js";
import { secretsRouter } from "./modules/secrets/router.js";
import { sessionsRouter } from "./modules/sessions/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { templatesRouter } from "./modules/templates/router.js";

export const appRouter = t.router({
  templates: templatesRouter,
  agents: agentsRouter,
  schedules: schedulesRouter,
  sessions: sessionsRouter,
  secrets: secretsRouter,
  channels: channelsRouter,
  connections: connectionsRouter,
  skills: skillsRouter,
  approvals: approvalsRouter,
  egressRules: egressRulesRouter,
});

export type AppRouter = typeof appRouter;
