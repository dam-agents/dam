const LEGACY_TEMPLATE_ROOTS: Record<string, readonly string[]> = {
  "llm-wiki": ["wiki"],
  "plain-wiki": ["wiki", "sources"],
};

const FALLBACK_ROOTS: readonly string[] = ["wiki"];

export function legacyShareRoots(
  kbTemplateId: string | undefined,
): readonly string[] {
  if (kbTemplateId === undefined) return FALLBACK_ROOTS;
  return LEGACY_TEMPLATE_ROOTS[kbTemplateId] ?? FALLBACK_ROOTS;
}
