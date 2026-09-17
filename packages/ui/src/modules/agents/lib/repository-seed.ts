export interface RepositoryDraft {
  repositoryUrl: string;
  repositoryRef: string;
}

export function repositoryUrlError(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return "Enter the repository's https:// URL.";
  } catch {
    return "Enter the repository's https:// URL.";
  }
  return undefined;
}

export function repositorySeed(
  draft: RepositoryDraft,
): { url: string; ref?: string } | null {
  const url = draft.repositoryUrl.trim();
  if (!url) return null;
  const ref = draft.repositoryRef.trim();
  return { url, ...(ref ? { ref } : {}) };
}
