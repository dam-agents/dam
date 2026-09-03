const TOKEN_PATTERN = /[a-z0-9_]+/g;
const TOKEN_MAX_CHARS = 64;

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (
    token.length > 4 &&
    (token.endsWith("ses") ||
      token.endsWith("xes") ||
      token.endsWith("zes") ||
      token.endsWith("ches") ||
      token.endsWith("shes"))
  ) {
    return token.slice(0, -2);
  }
  if (
    token.length > 3 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length <= TOKEN_MAX_CHARS) out.push(stem(t));
  }
  return out;
}
