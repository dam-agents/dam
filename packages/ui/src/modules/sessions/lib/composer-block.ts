import { COMPOSER_LOCKED_REASON } from "../../a2ui/lib/composer-lock.js";

export type ComposerBlock =
  | { kind: "providers-loading"; reason: string }
  | { kind: "providers-failed"; reason: string }
  | { kind: "connect"; reason: string }
  | { kind: "attach"; reason: string }
  | { kind: "form"; reason: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: why the composer holds a prompt, if it does. A
 * send plans its provider and model from the agent's provider lists, so it
 * waits until both lists are read: a send planned on lists still loading, or
 * failed, finds nothing to attach and would go out with no provider. A failed
 * refetch over lists already read leaves the send on those lists.
 */
export function composerBlock(input: {
  agentId: string | null;
  providers: { loaded: boolean; failed: boolean };
  noProviders: boolean;
  noGrantedProvider: boolean;
  sharedCurveBender: boolean;
  formLocked: boolean;
}): ComposerBlock | null {
  if (input.agentId && !input.providers.loaded)
    return input.providers.failed
      ? {
          kind: "providers-failed",
          reason:
            "Couldn't load the model providers. Reload the page to retry.",
        }
      : { kind: "providers-loading", reason: "Loading model providers…" };
  if (input.noGrantedProvider && !input.sharedCurveBender)
    return input.noProviders
      ? { kind: "connect", reason: "Connect an LLM provider to start." }
      : {
          kind: "attach",
          reason: "Attach an LLM provider to this agent to start.",
        };
  if (input.formLocked) return { kind: "form", reason: COMPOSER_LOCKED_REASON };
  return null;
}
