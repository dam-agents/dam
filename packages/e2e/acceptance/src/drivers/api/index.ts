import type { World } from "../../world.js";
import type { Driver } from "../driver.js";
import type { Pages } from "../ui/pages.js";
import { apiConnections } from "./connections.js";
import { apiArtifacts } from "./artifacts.js";
import { apiAgents } from "./agents.js";
import { apiChat } from "./chat.js";
import { apiEnvironment } from "./environment.js";
import { apiLive } from "./live.js";
import { apiSession } from "./session.js";
import { apiSessions } from "./sessions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver over the install's public API: tRPC for what an owner holds, and the ACP relay for a chat turn, as the CLI and other clients use them. A browser page serves it only where a person answers Keycloak, as in the CLI's sign-in.
 */
export function apiDriver(world: World, pages: Pages): Driver {
  return {
    surface: "api",
    session: apiSession(world, pages),
    agents: apiAgents(world),
    chat: apiChat(world),
    artifacts: apiArtifacts(world),
    connections: apiConnections(world),
    sessions: apiSessions(world),
    live: apiLive(world),
    environment: apiEnvironment(world),
  };
}
