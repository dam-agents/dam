/**
 * Public surface of the `instances` module. The narrow seam other CLI
 * modules consume per ADR-039's CLI carve-out. Only application-service
 * interfaces and the error variants their signatures reference leak —
 * no factories, no concrete services, no domain values, no
 * infrastructure adapters.
 *
 * Issue 3 extends this with the Instance Resolver and the resolver-
 * specific error variants (`NotFoundError`, `AmbiguousError`) for
 * downstream verbs (`dam shell`, #86) to consume.
 */
export type { InstancesService } from "./services/instances-service.js";
export type {
  TransportError,
  AuthRequiredError,
} from "./domain/errors.js";
