import { match } from "ts-pattern";
import type { ModelDialect } from "../../model-catalog/index.js";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * UNIT_BOUNDARY_DESCRIPTION: a session's subagent effort replaces the effort
 * a subagent's call carries, in the field its dialect uses. A call that
 * carries none is left alone: the harness sends no effort to a model that
 * takes none (Haiku), and adding one there would be refused.
 */
export function withSubagentEffort(
  body: Json,
  dialect: ModelDialect,
  effort: string,
): Json {
  return match(dialect)
    .with("anthropic-messages", () =>
      isObject(body.output_config) && "effort" in body.output_config
        ? { ...body, output_config: { ...body.output_config, effort } }
        : body,
    )
    .with("openai-responses", () =>
      isObject(body.reasoning) && "effort" in body.reasoning
        ? { ...body, reasoning: { ...body.reasoning, effort } }
        : body,
    )
    .with("openai-chat", () =>
      "reasoning_effort" in body ? { ...body, reasoning_effort: effort } : body,
    )
    .exhaustive();
}
