import { protectedProcedure, t } from "../../trpc.js";
import { applyStateInput } from "./types.js";

/**
 * `runtime.v1.*` — the unified runtime channel (ADR-052). Per the versioning
 * rule (ADR-052 §"Versioning"), adding a Contribution kind, Event kind, or
 * optional payload field stays on `v1` — capability flags carry the gate.
 * A semantic break or required new field bumps to `runtime.v2.*` and both
 * majors coexist for one release window.
 *
 * Authentication of the api-server → agent-runtime hop is enforced by the
 * pod's NetworkPolicy (ingress only from api-server). No in-process auth check.
 */
const v1Router = t.router({
  applyState: protectedProcedure
    .input(applyStateInput)
    .mutation(async ({ ctx, input }) => ctx.runtime.applyState(input)),
});

export const runtimeRouter = t.router({
  v1: v1Router,
});
