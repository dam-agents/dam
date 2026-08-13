// The platform API surface — one router, two doors. The HTTP door's
// denials are answered upstream by the admission middleware chain; the WS
// door encodes its own through mappers.ts.

export { createApiContextFactory } from "./context.js";
export { createTrpcHttpHandler } from "./http.js";
export { createTrpcWsEndpoint, type TrpcWsDeps } from "./ws.js";
export { trpcDenial } from "./mappers.js";
