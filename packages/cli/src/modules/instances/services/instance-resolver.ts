import type { Instance } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type {
  AmbiguousError,
  AuthRequiredError,
  NotFoundError,
  TransportError,
} from "../domain/errors.js";
import type { InstancesService } from "./instances-service.js";

/**
 * The Reserved ID Prefix. Anything starting with it is treated as an
 * Instance ID; anything else is a name. The api-server forbids names
 * that begin with this prefix at create-time, so the syntactic split
 * cannot be ambiguous on freshly-created Instances. Pre-existing
 * duplicate names (legacy state) still fall out via the name branch's
 * `ambiguous` path.
 */
export const INSTANCE_ID_PREFIX = "inst-";

export type ResolveError =
  | NotFoundError
  | AmbiguousError
  | TransportError
  | AuthRequiredError;

export interface InstanceResolver {
  /**
   * Convert a user-typed Instance Ref into the owner's Instance.
   *
   * One round-trip per resolution in both branches; no retries, no
   * caching. The `inst-` prefix is purely syntactic — the resolver
   * does not separately verify that the server still recognises the
   * prefix as ID-shaped.
   */
  resolve(ref: string): Promise<Result<Instance, ResolveError>>;
}

export interface InstanceResolverDeps {
  instancesService: InstancesService;
}

export function createInstanceResolver(deps: InstanceResolverDeps): InstanceResolver {
  return {
    async resolve(ref) {
      if (ref.startsWith(INSTANCE_ID_PREFIX)) {
        const got = await deps.instancesService.get(ref);
        if (!got.ok) return got;
        if (got.value === null) return err({ kind: "not-found", ref, via: "id" });
        return ok(got.value);
      }

      const listed = await deps.instancesService.list();
      if (!listed.ok) return listed;
      const matches = listed.value.filter((i) => i.name === ref);
      if (matches.length === 0) return err({ kind: "not-found", ref, via: "name" });
      if (matches.length === 1) return ok(matches[0]!);
      return err({
        kind: "ambiguous",
        ref,
        matches: matches.map((i) => ({ id: i.id, name: i.name })),
      });
    },
  };
}
