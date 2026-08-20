import { z } from "zod";

export const turnEventKinds = [
  "user-message",
  "assistant-message",
  "tool-call",
  "tool-result",
  "compaction",
  "turn-end",
] as const;

export type TurnEventKind = (typeof turnEventKinds)[number];

export const userMessagePayloadSchema = z.object({
  text: z.string(),
  source: z.enum(["user", "schedule", "channel"]).default("user"),
});

export const assistantMessagePayloadSchema = z.object({
  text: z.string(),
});

export const toolCallPayloadSchema = z.object({
  callId: z.string(),
  tool: z.string(),
  args: z.unknown(),
});

export const toolResultPayloadSchema = z.object({
  callId: z.string(),
  output: z.string(),
  isError: z.boolean().optional(),
  interrupted: z.boolean().optional(),
});

export const compactionPayloadSchema = z.object({
  summary: z.string(),
  coversThroughEventId: z.number(),
});

export const turnEndPayloadSchema = z.object({
  status: z.enum(["done", "interrupted", "error"]),
  reason: z.string().optional(),
});

export type UserMessagePayload = z.infer<typeof userMessagePayloadSchema>;
export type AssistantMessagePayload = z.infer<
  typeof assistantMessagePayloadSchema
>;
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>;
export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>;
export type CompactionPayload = z.infer<typeof compactionPayloadSchema>;
export type TurnEndPayload = z.infer<typeof turnEndPayloadSchema>;

export interface TurnEvent {
  id: number;
  sessionId: string;
  turnId: string;
  seq: number;
  kind: TurnEventKind;
  payload: unknown;
  createdAt: Date;
}

export type ContextMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | {
      role: "assistant-tool-call";
      callId: string;
      tool: string;
      args: unknown;
    }
  | {
      role: "tool-result";
      callId: string;
      tool: string;
      output: string;
      isError: boolean;
    };

export interface TurnContext {
  messages: ContextMessage[];
  danglingToolCalls: ToolCallPayload[];
}

export function buildTurnContext(events: TurnEvent[]): TurnContext {
  const lastCompaction = [...events]
    .reverse()
    .find((e) => e.kind === "compaction");
  const messages: ContextMessage[] = [];
  const openCalls = new Map<string, ToolCallPayload>();

  if (lastCompaction) {
    const { summary } = compactionPayloadSchema.parse(lastCompaction.payload);
    messages.push({
      role: "user",
      text: `[Conversation summary — earlier history was compacted]\n${summary}`,
    });
  }
  const coversThrough = lastCompaction
    ? compactionPayloadSchema.parse(lastCompaction.payload).coversThroughEventId
    : -1;

  for (const event of events) {
    if (event.id <= coversThrough || event.kind === "compaction") continue;
    switch (event.kind) {
      case "user-message": {
        const p = userMessagePayloadSchema.parse(event.payload);
        messages.push({ role: "user", text: p.text });
        break;
      }
      case "assistant-message": {
        const p = assistantMessagePayloadSchema.parse(event.payload);
        messages.push({ role: "assistant", text: p.text });
        break;
      }
      case "tool-call": {
        const p = toolCallPayloadSchema.parse(event.payload);
        openCalls.set(p.callId, p);
        messages.push({ role: "assistant-tool-call", ...p });
        break;
      }
      case "tool-result": {
        const p = toolResultPayloadSchema.parse(event.payload);
        const call = openCalls.get(p.callId);
        openCalls.delete(p.callId);
        messages.push({
          role: "tool-result",
          callId: p.callId,
          tool: call?.tool ?? "unknown",
          output: p.output,
          isError: p.isError ?? false,
        });
        break;
      }
      case "turn-end":
        break;
    }
  }
  return { messages, danglingToolCalls: [...openCalls.values()] };
}
