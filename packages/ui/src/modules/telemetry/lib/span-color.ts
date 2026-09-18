const KIND_COLORS: Record<string, string> = {
  interaction: "#a56eff",
  llm_request: "#1192e8",
  tool: "#009d9a",
  "tool.execution": "#0f9b98",
  "tool.blocked_on_user": "#b28600",
  hook: "#6929c4",
};

const FALLBACK = "#5f6a7a";

export function spanColor(name: string): string {
  const short = name.startsWith("claude_code.") ? name.slice(12) : name;
  return KIND_COLORS[short] ?? FALLBACK;
}
