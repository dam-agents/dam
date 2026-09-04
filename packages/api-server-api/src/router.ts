import { t } from "./trpc.js";
import { agentsRouter } from "./modules/agents/router.js";
import { apiKeysRouter } from "./modules/api-keys/router.js";
import { artifactLibraryRouter } from "./modules/artifact-library/router.js";
import { budgetsRouter } from "./modules/budgets/router.js";
import { approvalsRouter } from "./modules/approvals/router.js";
import { caseStudiesRouter } from "./modules/case-studies/router.js";
import { channelsRouter } from "./modules/channels/router.js";
import { connectionsRouter } from "./modules/connections/router.js";
import { e2eRouter } from "./modules/e2e/router.js";
import { egressRulesRouter } from "./modules/egress-rules/router.js";
import { eventsRouter } from "./modules/events/router.js";
import { experimentsRouter } from "./modules/experiments/router.js";
import { kbSharesRouter } from "./modules/kb-shares/router.js";
import { knowledgeBasesRouter } from "./modules/knowledge-bases/router.js";
import { linksRouter } from "./modules/links/router.js";
import { featuresRouter } from "./modules/features/router.js";
import { filesRouter } from "./modules/files/router.js";
import { harnessConfigRouter } from "./modules/harness-config/router.js";
import { schedulesRouter } from "./modules/schedules/router.js";
import { skillsRouter } from "./modules/skills/router.js";
import { reposRouter } from "./modules/repos/router.js";
import { metricsRouter } from "./modules/metrics/router.js";
import { templatesRouter } from "./modules/templates/router.js";
import { termsRouter } from "./modules/terms/router.js";
import { usageRouter } from "./modules/usage/router.js";

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
  experiments: experimentsRouter,
  knowledgeBases: knowledgeBasesRouter,
  kbShares: kbSharesRouter,
  artifactLibrary: artifactLibraryRouter,
  caseStudies: caseStudiesRouter,
  features: featuresRouter,
  files: filesRouter,
  links: linksRouter,
  metrics: metricsRouter,
  terms: termsRouter,
  usage: usageRouter,
  e2e: e2eRouter,
  apiKeys: apiKeysRouter,
  harnessConfig: harnessConfigRouter,
  budgets: budgetsRouter,
  events: eventsRouter,
});

export type AppRouter = typeof appRouter;

export { markTermsProven } from "./trpc.js";
