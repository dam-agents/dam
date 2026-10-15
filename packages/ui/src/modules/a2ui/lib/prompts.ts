import { findRendererBlocks, separateRendererBlocks } from "api-server-api";
import { A2UI_VERSION } from "api-server-api/chat-forms";
import { z } from "zod";

const ActionPayload = z.object({
  name: z.string(),
  userMessage: z.string().optional(),
  surfaceId: z.string(),
  sourceComponentId: z.string(),
  timestamp: z.string(),
  context: z.record(z.string(), z.unknown()),
});

const ErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  surfaceId: z.string().optional(),
  functionCallId: z.string().optional(),
  path: z.string().optional(),
});

const FunctionResponsePayload = z.object({
  functionCallId: z.string(),
  value: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

const RendererMessage = z.union([
  z.object({ version: z.literal(A2UI_VERSION), action: ActionPayload }),
  z.object({ version: z.literal(A2UI_VERSION), error: ErrorPayload }),
  z.object({
    version: z.literal(A2UI_VERSION),
    rendererFunctionResponse: FunctionResponsePayload,
  }),
]);

const DataModels = z.object({
  version: z.literal(A2UI_VERSION),
  surfaces: z.record(z.string(), z.unknown()),
});

export type ActionPayload = z.infer<typeof ActionPayload>;
export type ErrorPayload = z.infer<typeof ErrorPayload>;
export type RendererMessage = z.infer<typeof RendererMessage>;

export interface ParsedUserText {
  text: string;
  messages: RendererMessage[];
  dataModelSurfaces: string[];
}

export function formatRendererMessage(message: RendererMessage): string {
  return `<a2ui-message>\n${JSON.stringify(message)}\n</a2ui-message>`;
}

export function withDataModels(
  text: string,
  models: Readonly<Record<string, unknown>>,
): string {
  if (Object.keys(models).length === 0) return text;
  const payload = JSON.stringify({ version: A2UI_VERSION, surfaces: models });
  return `${text}\n\n<a2ui-data-model>\n${payload}\n</a2ui-data-model>`;
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source.trim());
  } catch {
    return undefined;
  }
}

export function hasRendererBlocks(text: string): boolean {
  return (
    text.includes("<a2ui-message>") ||
    text.includes("<a2ui-data-model>") ||
    text.includes("<a2ui-capabilities>")
  );
}

export function parseUserText(text: string): ParsedUserText {
  const blocks = findRendererBlocks(text);
  const messages = blocks.flatMap(({ tag, body }) => {
    if (tag !== "message") return [];
    const parsed = RendererMessage.safeParse(parseJson(body));
    return parsed.success ? [parsed.data] : [];
  });
  const dataModelSurfaces = blocks.flatMap(({ tag, body }) => {
    if (tag !== "data-model") return [];
    const parsed = DataModels.safeParse(parseJson(body));
    return parsed.success ? Object.keys(parsed.data.surfaces) : [];
  });
  return {
    text: separateRendererBlocks(text).text,
    messages,
    dataModelSurfaces,
  };
}
