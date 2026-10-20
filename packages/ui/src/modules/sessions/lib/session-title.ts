export function sessionTitleLabel(s: {
  title?: string | null;
  sessionId: string;
}): string {
  return s.title || `(no title · ${s.sessionId.slice(0, 8)})`;
}
