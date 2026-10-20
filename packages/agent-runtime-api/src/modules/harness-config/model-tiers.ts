export const CLAUDE_TIERS = ["fable", "opus", "sonnet", "haiku"] as const;
export type ClaudeTier = (typeof CLAUDE_TIERS)[number];

const NOT_A_CHAT_MODEL = /embed|rerank|tts|whisper|moderation|image|audio/i;

const isDateLike = (part: string): boolean => part.length >= 8;
const versionKey = (id: string): [number[], number[]] => {
  const parts = id.match(/\d+/g) ?? [];
  return [
    parts.filter((p) => !isDateLike(p)).map(Number),
    parts.filter(isDateLike).map(Number),
  ];
};
const cmpParts = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

export const compareModelVersions = (a: string, b: string): number => {
  const [va, da] = versionKey(a);
  const [vb, db] = versionKey(b);
  return cmpParts(va, vb) || cmpParts(da, db) || (a < b ? -1 : a > b ? 1 : 0);
};

export const chatModels = (ids: readonly string[]): string[] =>
  ids.filter((id) => !NOT_A_CHAT_MODEL.test(id));

export const newestOfTier = (
  ids: readonly string[],
  tier: ClaudeTier,
): string | null => {
  const tiered = chatModels(ids).filter((id) =>
    id.toLowerCase().includes(tier),
  );
  const sorted = [...tiered].sort(compareModelVersions);
  return sorted[sorted.length - 1] ?? null;
};

export const claudeTierOf = (name: string): ClaudeTier | null => {
  const word = name
    .trim()
    .toLowerCase()
    .replace(/^claude\//, "")
    .replace(/\[1m\]$/, "");
  return (CLAUDE_TIERS as readonly string[]).includes(word)
    ? (word as ClaudeTier)
    : null;
};
