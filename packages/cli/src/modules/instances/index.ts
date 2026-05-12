/**
 * Public surface of the `instances` module. The narrow seam other CLI
 * modules consume per ADR-039's CLI carve-out. Only application-service
 * interfaces and the error variants their signatures reference leak —
 * no factories, no concrete services, no domain values, no
 * infrastructure adapters.
 *
 * Downstream verbs that target an Instance (e.g. `dam shell`, #86)
 * import `InstanceResolver` from here and consume the resolver via the
 * `instancesService` factory exported by the module's compose.
 */
export type { InstancesService } from "./services/instances-service.js";
export type {
  InstanceResolver,
  ResolveError,
} from "./services/instance-resolver.js";
export type {
  TransportError,
  AuthRequiredError,
  NotFoundError,
  AmbiguousError,
} from "./domain/errors.js";
