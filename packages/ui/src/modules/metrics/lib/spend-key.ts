export function keyAgentId(key: unknown): string | undefined {
  const opts = Array.isArray(key)
    ? (key[1] as { input?: { agentId?: string } } | undefined)
    : undefined;
  return opts?.input?.agentId;
}
