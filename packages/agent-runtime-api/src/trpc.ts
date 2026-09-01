import { initTRPC } from "@trpc/server";
import type { AgentRuntimeContext } from "./context.js";
import {
  SOURCE_PATH_REASONS,
  type SourcePathReason,
} from "./modules/skills/types.js";

interface UpstreamCause {
  upstream?: { status: number; body: unknown };
}

interface SourcePathCause {
  sourcePath?: { reason: SourcePathReason; version?: string };
}

function extractUpstream(
  cause: unknown,
): UpstreamCause["upstream"] | undefined {
  if (cause && typeof cause === "object" && "upstream" in cause) {
    const u = (cause as UpstreamCause).upstream;
    if (u && typeof u === "object" && typeof u.status === "number") return u;
  }
  return undefined;
}

function extractSourcePath(
  cause: unknown,
): SourcePathCause["sourcePath"] | undefined {
  if (cause && typeof cause === "object" && "sourcePath" in cause) {
    const sp = (cause as SourcePathCause).sourcePath;
    if (
      sp &&
      typeof sp === "object" &&
      SOURCE_PATH_REASONS.includes(sp.reason)
    ) {
      return sp;
    }
  }
  return undefined;
}

export const t = initTRPC.context<AgentRuntimeContext>().create({
  errorFormatter: ({ shape, error }) => {
    const upstream = extractUpstream(error.cause);
    const sourcePath = extractSourcePath(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(upstream ? { upstream } : {}),
        ...(sourcePath ? { sourcePath } : {}),
      },
    };
  },
});

export const protectedProcedure = t.procedure;
