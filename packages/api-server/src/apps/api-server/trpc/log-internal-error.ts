import type { TRPCError } from "@trpc/server";
import { getLogger } from "../../../core/logger.js";

export function logInternalError(opts: {
  error: TRPCError;
  path: string | undefined;
}): void {
  if (opts.error.code !== "INTERNAL_SERVER_ERROR") return;
  getLogger().error(
    { err: opts.error.cause ?? opts.error, path: opts.path },
    "trpc internal error",
  );
}
