// Agent proxies — every surface that fronts an agent pod: the three WS
// relays (acp / terminal / ssh) plus the HTTP trpc- and import-proxies,
// with the upgrade dispatch and relay admission that guard the WS family.

export { createAcpRelay } from "./acp-relay.js";
export { createTerminalRelay } from "./terminal-relay.js";
export { createSshRelay } from "./ssh-relay.js";
export {
  createSessionPresence,
  type SessionPresence,
} from "./session-presence.js";
export { createAgentTrpcProxy } from "./trpc-proxy.js";
export { createImportProxy } from "./import-proxy.js";
export {
  createRelayAdmission,
  createUpgradeHandler,
  relayRoute,
  selfAuthenticated,
  type RelayAdmission,
  type RelayAdmissionDenialKind,
  type RelayAdmissionResult,
  type RelayDenialKind,
  type UpgradeRouteHandler,
} from "./upgrade.js";
export { upgradeDenial } from "./mappers.js";
