import { err, ok, type Result } from "../../../result.js";
import type {
  AmbiguousError,
  AuthRequiredError,
  NotFoundError,
  TransportError,
} from "../domain/errors.js";
import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "./agent-service.js";

export const AGENT_ID_PREFIX = "agent-";

export type ResolveError =
  | NotFoundError
  | AmbiguousError
  | TransportError
  | AuthRequiredError;

export interface AgentResolver {
  resolve(ref: string): Promise<Result<AgentView, ResolveError>>;
}

export function createAgentResolver(deps: {
  agentService: AgentService;
}): AgentResolver {
  return {
    async resolve(ref) {
      if (ref.startsWith(AGENT_ID_PREFIX)) {
        const got = await deps.agentService.get(ref);
        if (!got.ok) return got;
        if (got.value === null)
          return err({ kind: "not-found", ref, via: "id" });
        return ok(got.value);
      }

      const listed = await deps.agentService.list();
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
