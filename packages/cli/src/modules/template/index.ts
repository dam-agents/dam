/**
 * Public surface of the `template` module. Narrow seam consumed by
 * other CLI modules (e.g. `agent create` needs the service to validate
 * `--template` before issuing the agents.create mutation).
 */
export type { Template, TemplateService } from "./services/template-service.js";
