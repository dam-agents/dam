import { installFakeBackend } from "./install";

// Must run before api.ts is evaluated: the tRPC WS client captures the
// WebSocket constructor when it is created.
installFakeBackend();
