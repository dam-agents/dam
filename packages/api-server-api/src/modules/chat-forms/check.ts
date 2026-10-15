import { buildConversation, type RendererError } from "./conversation.js";
import { hasA2uiBlock, splitA2uiBlocks } from "./split-blocks.js";

export interface ChatFormCheck {
  ok: boolean;
  surfaces: { surfaceId: string; created: boolean; lockComposer: boolean }[];
  problems: RendererError[];
}

function blockSources(reply: string): {
  sources: string[];
  problems: RendererError[];
} {
  if (!hasA2uiBlock(reply)) return { sources: [reply], problems: [] };
  const blocks = splitA2uiBlocks(reply).flatMap((segment) =>
    segment.kind === "a2ui" ? [segment] : [],
  );
  if (blocks.length === 0)
    return {
      sources: [],
      problems: [
        {
          code: "VALIDATION_FAILED",
          message:
            "The reply mentions <a2ui-json> but no block opens at the start of a line, so the chat shows it as text.",
        },
      ],
    };
  return {
    sources: blocks.map((block) => block.source),
    problems: blocks.flatMap((block, index) =>
      block.closed
        ? []
        : [
            {
              code: "VALIDATION_FAILED",
              message: `Block ${index} has no closing </a2ui-json> tag.`,
            },
          ],
    ),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: validates a reply the way the web chat replays it, except that a surface the reply updates without creating is taken to come from an earlier reply, and agent function calls are checked but not run.
export function checkChatForm(reply: string): ChatFormCheck {
  const { sources, problems } = blockSources(reply);
  const { surfaces, blocks } = buildConversation(
    sources.map((source, index) => ({
      key: String(index),
      messageId: "check",
      source,
      closed: true,
    })),
    { callFunction: () => null, assumeEarlierSurfaces: true },
  );
  for (const block of blocks.values()) {
    problems.push(...block.errors);
    for (const call of block.functionCalls)
      if (call.response.error)
        problems.push({
          code: call.response.error.code,
          message: `callRendererFunction "${call.name}": ${call.response.error.message}`,
        });
  }
  return {
    ok: problems.length === 0,
    surfaces: [...surfaces.values()].map((surface) => ({
      surfaceId: surface.id,
      created: !surface.assumed,
      lockComposer: surface.lockComposer,
    })),
    problems,
  };
}
