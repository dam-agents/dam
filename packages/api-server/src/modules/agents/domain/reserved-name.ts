import { TRPCError } from "@trpc/server";
import type { AgentKind } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The assistant's name belongs to the one Agent the
 * api-server provisions for a person, so the name is reserved and fixed. Both
 * refusals live here, on the create and the rename every path goes through —
 * the UI's, the CLI's and a starter kit's — and both name the assistant as the
 * install brands it, because the caller's own form is where the name came from.
 * The provisioning create is the one caller allowed to use it, which it says by
 * creating an assistant-kind Agent.
 */
export function assertNameNotReserved(
  name: string,
  kind: AgentKind | undefined,
  assistantName: string,
): void {
  if (name !== assistantName || kind === "assistant") return;
  throw new TRPCError({
    code: "CONFLICT",
    message: `"${assistantName}" is the name of your assistant, so another agent cannot take it.`,
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: whether a genuine rename is allowed at all: every Agent may be renamed except the assistant, whose name is the reserved one its owner sees in the error. */
export function assertRenameAllowed(
  kind: AgentKind | undefined,
  assistantName: string,
): void {
  if (kind !== "assistant") return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `${assistantName} is your assistant, so its name cannot change.`,
  });
}
