import { initTRPC } from "@trpc/server";
import type { ScriptedMockService } from "./modules/scripted-mock/types.js";

export interface MockAgentContext {
  scriptedMock: ScriptedMockService;
}

export const t = initTRPC.context<MockAgentContext>().create();
