const RECOMMENDED = /\s*\(recommended\)\s*$/i;

export function splitRecommended(label: string): {
  text: string;
  recommended: boolean;
} {
  const text = label.replace(RECOMMENDED, "");
  return { text, recommended: text !== label };
}
