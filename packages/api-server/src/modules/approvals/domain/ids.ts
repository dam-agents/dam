export function acpNativeRowId(
  agentId: string,
  sessionId: string,
  rpcId: number | string,
): string {
  return `acpnative:${agentId}:${sessionId}:${rpcId}`;
}
