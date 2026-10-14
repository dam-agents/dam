const RENDERER_BLOCK =
  /<a2ui-(message|data-model|capabilities)>[\s\S]*?<\/a2ui-\1>/g;

export function separateRendererBlocks(text: string): {
  text: string;
  blocks: string;
} {
  return {
    text: text.replace(RENDERER_BLOCK, "").trim(),
    blocks: (text.match(RENDERER_BLOCK) ?? []).join("\n\n"),
  };
}

export function joinRendererBlocks(text: string, blocks: string): string {
  if (!blocks) return text;
  return text ? `${text}\n\n${blocks}` : blocks;
}
