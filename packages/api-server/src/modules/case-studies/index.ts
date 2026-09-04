export {
  composeCaseStudiesModule,
  composeCaseStudiesForOwner,
} from "./compose.js";
export type { CaseStudiesModule, CaseStudiesModuleDeps } from "./compose.js";
export type { CaseStudySubmissionsService } from "./services/submissions-service.js";
export type { CaseStudyInspectionService } from "./services/inspection-service.js";
export type { CaseStudyRetentionSweeper } from "./services/retention-sweeper.js";
export { registerCaseStudyTools } from "./mcp-tools.js";
