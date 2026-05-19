/** Deterministic id for ACP-native pending rows. JSON-RPC ids are unique
 *  per wrapper process, so `(agentId, rpcId)` uniquely identifies the
 *  request — no `sessionId` needed in the key. The relay computes this
 *  from any JSON-RPC response it sees and CAS-resolves; non-permission
 *  responses miss the row and silently no-op. */
export function acpNativeRowId(
  agentId: string,
  rpcId: number | string,
): string {
  return `acpnative:${agentId}:${rpcId}`;
}
