/** The agent a spend query key was narrowed to, or `undefined` for an
 *  unnarrowed read. tRPC keys carry the procedure input at `[path, { input }]`,
 *  typed as `unknown` by the client — hence the read-through. A key of any other
 *  shape reads as unnarrowed, which withholds the placeholder from a narrowed
 *  caller rather than handing it another agent's figures. */
export function keyAgentId(key: unknown): string | undefined {
  const opts = Array.isArray(key)
    ? (key[1] as { input?: { agentId?: string } } | undefined)
    : undefined;
  return opts?.input?.agentId;
}
