import type { HarnessFamily, HarnessView } from "api-server-api";

import type { TemplateView } from "../../../types.js";

export const SHARED_IMAGE_TEMPLATE_ID = "default";

const TEMPLATE_ID_OF_HARNESS: Readonly<Record<string, string>> = {
  "claude-code": "claude-code",
  codex: "codex",
  pi: "pi-agent",
  bob: "bob",
};

const HARNESS_OF_TEMPLATE_ID: Readonly<Record<string, HarnessFamily>> =
  Object.fromEntries(
    Object.entries(TEMPLATE_ID_OF_HARNESS).map(([harness, id]) => [
      id,
      harness,
    ]),
  ) as Record<string, HarnessFamily>;

export function harnessForTemplateId(
  templateId: string | null | undefined,
): HarnessFamily | undefined {
  return templateId ? HARNESS_OF_TEMPLATE_ID[templateId] : undefined;
}

export function withHarnessTemplates(
  templates: readonly TemplateView[],
  catalogue: { harnesses: readonly HarnessView[] } | undefined,
): TemplateView[] {
  const shared = templates.find((t) => t.id === SHARED_IMAGE_TEMPLATE_ID);
  if (!shared || !catalogue) return [...templates];
  const harnesses = catalogue.harnesses.flatMap((harness): TemplateView[] => {
    const id = TEMPLATE_ID_OF_HARNESS[harness.name];
    if (id === undefined) return [];
    return [
      {
        id,
        name: harness.displayName,
        image: shared.image,
        description: harness.description,
        category: "harness",
        harness: harness.name,
        providers: harness.providers,
        tags: harness.tags,
        releaseNotesUrl: harness.releaseNotesUrl,
        experimental: harness.experimental,
      },
    ];
  });
  return [...templates, ...harnesses];
}
