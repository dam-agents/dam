export type { KitService, KitCreateResult } from "./services/kit-service.js";
export { createKitService } from "./services/kit-service.js";
export { KIT_REF_HELP } from "./commands/show.js";
export {
  kitErrorDescription,
  resolveKitOrExit,
} from "./commands/resolve-kit.js";
export {
  preselectedGrants,
  remainingSteps,
  templateIndex,
  type KitStep,
} from "./domain/kit-plan.js";
export { kitRefOf, parseAgentKitRef } from "./domain/kit-ref.js";
export { describeKitUpdate } from "./domain/kit-update.js";
