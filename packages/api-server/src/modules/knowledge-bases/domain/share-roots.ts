import { match } from "ts-pattern";
import { knowledgeBaseTemplateIdSchema } from "api-server-api";

const FALLBACK_ROOTS: readonly string[] = ["wiki"];

export function defaultShareRootsForKbTemplate(
  kbTemplateId: string | undefined,
): readonly string[] {
  const parsed = knowledgeBaseTemplateIdSchema.safeParse(kbTemplateId);
  if (!parsed.success) return FALLBACK_ROOTS;
  return match(parsed.data)
    .with("llm-wiki", (): readonly string[] => ["wiki"])
    .with("plain-wiki", (): readonly string[] => ["wiki", "sources"])
    .exhaustive();
}
