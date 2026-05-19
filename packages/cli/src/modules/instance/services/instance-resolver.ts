import type { Instance } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type {
  AmbiguousError,
  AuthRequiredError,
  NotFoundError,
  TransportError,
} from "../domain/errors.js";
import type { InstanceService } from "./instance-service.js";

export const INSTANCE_ID_PREFIX = "inst-";

export type ResolveError =
  | NotFoundError
  | AmbiguousError
  | TransportError
  | AuthRequiredError;

export interface InstanceResolver {
  resolve(ref: string): Promise<Result<Instance, ResolveError>>;
}

export function createInstanceResolver(deps: {
  instanceService: InstanceService;
}): InstanceResolver {
  return {
    async resolve(ref) {
      if (ref.startsWith(INSTANCE_ID_PREFIX)) {
        const got = await deps.instanceService.get(ref);
        if (!got.ok) return got;
        if (got.value === null)
          return err({ kind: "not-found", ref, via: "id" });
        return ok(got.value);
      }

      const listed = await deps.instanceService.list();
      if (!listed.ok) return listed;
      const matches = listed.value.filter((i) => i.name === ref);
      if (matches.length === 0)
        return err({ kind: "not-found", ref, via: "name" });
      if (matches.length === 1) return ok(matches[0]!);
      return err({
        kind: "ambiguous",
        ref,
        matches: matches.map((i) => ({ id: i.id, name: i.name })),
      });
    },
  };
}
