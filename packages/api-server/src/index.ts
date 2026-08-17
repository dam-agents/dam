import { bootstrap } from "./bootstrap.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";
import { startExtAuthzGrpcApp } from "./apps/ext-authz/grpc.js";

const { apiServerDeps, harnessDeps, extAuthzDeps, cleanup } = await bootstrap();

const {
  server: apiServer,
  trpcWs,
  closeRelays,
} = startApiServerApp(apiServerDeps);
const { server: harnessApiServer } = startHarnessApiServerApp(harnessDeps);
const { server: extAuthzGrpcServer } = await startExtAuthzGrpcApp(extAuthzDeps);

let shuttingDown = false;
const onSignal = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    process.stderr.write("shutting down...\n");
    apiServer.close();
    harnessApiServer.close();
    extAuthzGrpcServer.tryShutdown(() => {});
    trpcWs.drain();
    await trpcWs.close();
    closeRelays();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await cleanup();
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
