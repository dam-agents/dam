import type { World } from "../../world.js";
import type { Driver } from "../driver.js";
import { uiConnections } from "./connections.js";
import { uiArtifacts } from "./artifacts.js";
import { uiAgents } from "./agents.js";
import { uiChat } from "./chat.js";
import type { Pages } from "./pages.js";
import { uiEnvironment } from "./environment.js";
import { uiLive } from "./live.js";
import { uiSession } from "./session.js";
import { uiSessions } from "./sessions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver over the web UI: each person acts in a browser page of their own, signed in once per worker unless a step signs them in afresh, and reads only what the page shows.
 */
export function uiDriver(world: World, pages: Pages): Driver {
  return {
    surface: "ui",
    session: uiSession(pages),
    agents: uiAgents(world, pages),
    chat: uiChat(world, pages),
    artifacts: uiArtifacts(pages),
    connections: uiConnections(world, pages),
    sessions: uiSessions(world, pages),
    live: uiLive(world, pages),
    environment: uiEnvironment(world, pages),
  };
}
