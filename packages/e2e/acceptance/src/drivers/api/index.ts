import type { World } from "../../world.js";
import type { Driver } from "../driver.js";
import { apiArtifacts } from "./artifacts.js";
import { apiAgents } from "./agents.js";
import { apiChat } from "./chat.js";
import { apiSession } from "./session.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver over the install's public API: tRPC for what an owner holds, and the ACP relay for a chat turn, as the CLI and other clients use them.
 */
export function apiDriver(world: World): Driver {
  return {
    surface: "api",
    session: apiSession(world),
    agents: apiAgents(world),
    chat: apiChat(world),
    artifacts: apiArtifacts(world),
  };
}
