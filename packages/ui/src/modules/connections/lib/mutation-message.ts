import { TRPCClientError } from "@trpc/client";

// UNIT_BOUNDARY_DESCRIPTION: what a connection dialog says when its save fails. The server's own message is the honest one for a rejected input or a name already taken, because it names the field; anything else gets the dialog's generic line. The connection module's save dialogs share it.
export function mutationMessage(
  error: unknown,
  fallback: string,
): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (
    error instanceof TRPCClientError &&
    (error.data?.code === "BAD_REQUEST" || error.data?.code === "CONFLICT")
  ) {
    return error.message;
  }
  return fallback;
}
