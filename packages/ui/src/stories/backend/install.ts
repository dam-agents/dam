import { acpAgent } from "./acp-agent";
import { agentFixtures, agentHistory } from "./agent-fixtures";
import { platformFixtures } from "./platform-fixtures";
import { installFakeWebSocket, routeSocket } from "./socket";
import { trpcServer } from "./trpc-server";

let installed = false;

export function installFakeBackend() {
  if (installed) return;
  installed = true;
  installFakeWebSocket();
  routeSocket((url) =>
    url.pathname === "/api/trpc-ws"
      ? trpcServer("platform", platformFixtures)
      : null,
  );
  routeSocket((url) => {
    const m = url.pathname.match(/^\/api\/agents\/([^/]+)\/(trpc-ws|acp)$/);
    if (!m) return null;
    const agentId = decodeURIComponent(m[1]!);
    return m[2] === "acp"
      ? acpAgent(() => agentHistory(agentId))
      : trpcServer(`agent ${agentId}`, () => agentFixtures(agentId));
  });
}
