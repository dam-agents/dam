import { bootstrap } from "./bootstrap.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";
import { startExtAuthzGrpcApp } from "./apps/ext-authz/grpc.js";

// Process entry point and conductor: assemble everything (bootstrap), spawn
// the three network servers, and wire teardown to process signals. All
// construction + background-service cleanup lives in bootstrap; this file
// owns only the servers it spawns and the shutdown ordering.
const { apiServerDeps, harnessDeps, extAuthzDeps, cleanup } = await bootstrap();

const { server: apiServer, trpcWs } = startApiServerApp(apiServerDeps);
const { server: harnessApiServer } = startHarnessApiServerApp(harnessDeps);
const { server: extAuthzGrpcServer } = await startExtAuthzGrpcApp(extAuthzDeps);

let shuttingDown = false;
const onSignal = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    process.stderr.write("shutting down...\n");
    // Nudge events-socket clients onto surviving replicas first, then drop
    // the sockets this replica holds.
    trpcWs.drain();
    await trpcWs.close();
    // Background services and stores (bootstrap-owned).
    await cleanup();
    // Then the servers this file spawned.
    extAuthzGrpcServer.tryShutdown(() => {});
    harnessApiServer.close();
    apiServer.close();
    // Flush OTel if the --import bootstrap (dist/telemetry.js) registered it.
    // Reached via Symbol lookup — importing telemetry.ts here would evaluate a
    // second copy of that bundle and split the SDK singleton.
    const flushOtel = (globalThis as Record<symbol, unknown>)[
      Symbol.for("platform.otel.shutdown")
    ];
    if (typeof flushOtel === "function") {
      await (flushOtel as () => Promise<void>)();
    }
    process.exit(0);
  })();
};
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);
