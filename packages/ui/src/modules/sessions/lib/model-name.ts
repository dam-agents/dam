const CLAUDE_MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

export function modelDisplayName(id: string): string {
  const match = CLAUDE_MODEL_ID.exec(id);
  if (!match) return id;
  const [, family = "", major, minor] = match;
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`;
}
