/** A stable swatch color per arm. Comparison is the whole point of an
 *  experiment, so whose result you're looking at must be unmistakable (epic
 *  decision D10). The hue is derived from the agent id so the same arm keeps
 *  its color across the list, detail, and wizard without the server having to
 *  store one. */
export function armColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 62% 52%)`;
}
