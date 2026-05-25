import { initTRPC } from "@trpc/server";
import type { HarnessContext } from "./harness-context.js";

// Separate tRPC instance for the harness API — different context (agent
// identity from AuthorizationPolicy, not user JWT), different surface (agent
// callbacks, not user actions).
export const harnessT = initTRPC.context<HarnessContext>().create();
