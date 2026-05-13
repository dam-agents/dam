/**
 * Public surface of the `templates` module. Narrow seam consumed by
 * other CLI modules (e.g. `instances create` needs the service to
 * validate `--template` before issuing the agent + instance mutations).
 */
export type {
  Template,
  TemplatesService,
} from "./services/templates-service.js";
