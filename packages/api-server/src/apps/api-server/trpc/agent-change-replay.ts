import type {
  AgentChangePayload,
  AgentChangeResult,
  ApiContext,
  UserIdentity,
} from "api-server-api";
import { appRouter } from "api-server-api/router";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the verdict's own half of a change an assistant
 * asked for. It runs the held procedure in a context composed for the owner's
 * own authenticated identity — the scopes and the Agent binding they signed in
 * with, never a widened copy — so the gate that filed the change is not in its
 * way and the change cannot file another approval in its turn. Anything that is
 * not an interactive owner session runs nothing: an API key, an assistant's own
 * token and an editor standing all stop here as well as at the service.
 */
export function composeAgentChangeReplay(deps: {
  contextFor: (user: UserIdentity, surface: string) => ApiContext;
  user: UserIdentity;
  surface: string;
}): (payload: AgentChangePayload) => Promise<AgentChangeResult> {
  return async (payload) => {
    const { user } = deps;
    if (
      user.keyId !== undefined ||
      user.onBehalfAgentId !== undefined ||
      user.actingEditor !== undefined
    )
      return {
        procedure: payload.procedure,
        status: "failed",
        error: "a held change runs only for its owner's own session",
      };

    const caller = appRouter.createCaller(deps.contextFor(user, deps.surface));
    const run = payload.procedure
      .split(".")
      .reduce<Record<string, unknown> | undefined>(
        (node, key) =>
          (node?.[key] as Record<string, unknown> | undefined) ?? undefined,
        caller as unknown as Record<string, unknown>,
      );
    if (typeof run !== "function")
      return {
        procedure: payload.procedure,
        status: "failed",
        error: `\`${payload.procedure}\` no longer exists on this install`,
      };
    await (run as (input: unknown) => Promise<unknown>).call(
      null,
      payload.input,
    );
    return { procedure: payload.procedure, status: "ran", error: null };
  };
}
