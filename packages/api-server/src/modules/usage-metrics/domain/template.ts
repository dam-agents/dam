import { match } from "ts-pattern";

export const TEMPLATE_NONE = "none";
export const TEMPLATE_UNKNOWN = "unknown";
export const TEMPLATE_OTHER = "other";

export type AgentTemplate =
  { agent: "unresolved" } | { agent: "resolved"; templateId?: string };

export type TemplateOf = (agentId: string) => string;

export function createTemplateResolver(deps: {
  templateOf: (agentId: string) => AgentTemplate;
  known: ReadonlySet<string>;
}): TemplateOf {
  return (agentId) =>
    match(deps.templateOf(agentId))
      .with({ agent: "unresolved" }, () => TEMPLATE_UNKNOWN)
      .with({ agent: "resolved" }, ({ templateId }) =>
        !templateId
          ? TEMPLATE_NONE
          : deps.known.has(templateId)
            ? templateId
            : TEMPLATE_OTHER,
      )
      .exhaustive();
}
