/**
 * Public surface of the `template` module. Narrow seam consumed by
 * other CLI modules (e.g. `instance create` needs the service to
 * validate `--template` before issuing the agent + instance mutations).
 */
export type { Template, TemplateService } from "./services/template-service.js";
