import { initTRPC } from "@trpc/server";
import type { HarnessContext } from "./harness-context.js";

export const harnessT = initTRPC.context<HarnessContext>().create();
