import { initTRPC } from "@trpc/server";
import type { MockAgentContext } from "./context.js";

export const t = initTRPC.context<MockAgentContext>().create();
