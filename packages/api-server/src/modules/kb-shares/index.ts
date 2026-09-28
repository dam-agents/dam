export {
  composeKbPublishGate,
  composeKbShareAgentOps,
  composeKbSharesForOwner,
  createKbShareResolver,
  createKbShareAgentCleanup,
  findKbShareOwnerByAgent,
  listKbShareAgentIds,
  startKbShareSync,
  type KbShareAgentOps,
} from "./compose.js";
export { registerKbShareTools } from "./mcp-tools.js";
export { parseKbShareString as parseShareString } from "api-server-api";
export {
  shareIdFromTokenHeader,
  tokenHeaderName,
} from "./domain/share-string.js";
export {
  composeKbShareServing,
  createShareHostApp,
} from "./serving/compose.js";
