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

const closed = (s: { close(cb?: () => void): unknown }) =>
  new Promise<void>((resolve) => void s.close(() => resolve()));

let shuttingDown = false;
const onSignal = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    process.stderr.write("shutting down...\n");
    const listenersClosed = Promise.all([
      closed(apiServer),
      closed(harnessApiServer),
    ]);
    extAuthzGrpcServer.tryShutdown(() => {});
    trpcWs.drain();
    const wsClosed = Promise.resolve(trpcWs.close()).catch(() => {});
    closeRelays();
    const closeIdle = (s: unknown) =>
      (s as { closeIdleConnections?: () => void }).closeIdleConnections?.();
    const reap = setInterval(() => {
      closeIdle(apiServer);
      closeIdle(harnessApiServer);
    }, 1_000);
    reap.unref();
    await Promise.race([
      Promise.all([listenersClosed, wsClosed]),
      new Promise((resolve) => setTimeout(resolve, 25_000)),
    ]);
    clearInterval(reap);
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
