export function acpNativeRowId(
  agentId: string,
  rpcId: number | string,
): string {
  return `acpnative:${agentId}:${rpcId}`;
}
