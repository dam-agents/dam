import { TRPCError } from "@trpc/server";
import type { AgentKind } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The assistant's name belongs to the one Agent the
 * api-server provisions for a person, so the name is reserved and fixed: a
 * create or a rename to it is refused, and the assistant itself cannot be
 * renamed. Both refusals name the assistant as the install brands it, because
 * the caller's own form is where the name came from.
 */
export function assertAssistantNameAvailable(
  name: string,
  assistantName: string,
): void {
  if (name !== assistantName) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: `"${assistantName}" is the name of your assistant, so another agent cannot take it.`,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a rename is allowed at all: every Agent may
 * be renamed except the assistant, whose name is the reserved one its owner sees
 * in the error.
 */
export function assertRenameable(
  kind: AgentKind | undefined,
  name: string | undefined,
  current: string | undefined,
  assistantName: string,
): void {
  if (name === undefined || name === current) return;
  if (kind !== "assistant") return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `${assistantName} is your assistant, so its name cannot change.`,
  });
}
