export const MAX_ARG_LENGTH = 4096;
export const MAX_ARGV_LENGTH = 64;
export const MAX_REPEAT = 16;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface Placeholder {
  identifier: string;
  format: PlaceholderFormat;
}

type PlaceholderFormat =
  | { kind: "default" }
  | { kind: "path"; glob: string }
  | { kind: "int"; min: number; max: number | null }
  | { kind: "regex"; source: string };

interface TokenElement {
  kind: "token";
  source: string;
  regex: RegExp;
  placeholders: Placeholder[];
}

interface GroupElement {
  kind: "group";
  alternatives: Element[][];
  optional: boolean;
  repeat: boolean;
}

type Element = TokenElement | GroupElement;

export interface ParsedPattern {
  source: string;
  elements: Element[];
  dashDashAt: number;
}

const DEFAULT_VALUE = "[A-Za-z0-9._-]+";

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:[^/]*/)*";
          i += 2;
        } else {
          out += ".*";
          i++;
        }
      } else out += "[^/]*";
    } else out += escapeLiteral(ch);
  }
  return out;
}

function parseFormat(spec: string): ParseResult<PlaceholderFormat> {
  if (spec === "") return { ok: true, value: { kind: "default" } };
  if (spec.startsWith("^")) {
    if (!spec.endsWith("$"))
      return {
        ok: false,
        error: `regex format must end with "$": <…:${spec}>`,
      };
    try {
      new RegExp(spec);
    } catch (err) {
      return {
        ok: false,
        error: `invalid regex ${spec}: ${(err as Error).message}`,
      };
    }
    return { ok: true, value: { kind: "regex", source: spec } };
  }
  if (spec.startsWith(".") || spec.startsWith("/"))
    return { ok: true, value: { kind: "path", glob: spec } };
  const open = /^(\d+)\+$/.exec(spec);
  if (open)
    return {
      ok: true,
      value: { kind: "int", min: Number(open[1]), max: null },
    };
  const range = /^(\d+)-(\d+)$/.exec(spec);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > max)
      return { ok: false, error: `int range is inverted: <…:${spec}>` };
    return { ok: true, value: { kind: "int", min, max } };
  }
  return {
    ok: false,
    error: `unrecognized format "${spec}" — expected a path glob (./x, /x), an int range (0+, 1-50), or an anchored regex (^…$)`,
  };
}

function formatToRegex(format: PlaceholderFormat): string {
  switch (format.kind) {
    case "default":
      return DEFAULT_VALUE;
    case "path":
      return globToRegex(format.glob);
    case "int":
      return "\\d+";
    case "regex":
      return format.source.slice(1, -1);
  }
}

function splitTokens(run: string): ParseResult<string[]> {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of run) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (depth < 0) return { ok: false, error: `unbalanced "${ch}" in ${run}` };
    if (/\s/.test(ch) && depth === 0) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (depth !== 0) return { ok: false, error: `unbalanced brackets in ${run}` };
  if (current !== "") tokens.push(current);
  return { ok: true, value: tokens };
}

function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseToken(token: string): ParseResult<TokenElement> {
  const placeholders: Placeholder[] = [];
  let pattern = "";
  let i = 0;
  while (i < token.length) {
    const ch = token[i]!;
    if (ch === "<") {
      const close = token.indexOf(">", i);
      if (close === -1)
        return { ok: false, error: `unclosed placeholder in "${token}"` };
      const body = token.slice(i + 1, close);
      const colon = body.indexOf(":");
      const identifier = colon === -1 ? body : body.slice(0, colon);
      const spec = colon === -1 ? "" : body.slice(colon + 1);
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(identifier))
        return {
          ok: false,
          error: `placeholder needs an identifier: "<${body}>"`,
        };
      const format = parseFormat(spec);
      if (!format.ok) return format;
      placeholders.push({ identifier, format: format.value });
      pattern += `(${formatToRegex(format.value)})`;
      i = close + 1;
      continue;
    }
    if (ch === "(") {
      const close = matchingBracket(token, i);
      if (close === -1)
        return { ok: false, error: `unbalanced "(" in "${token}"` };
      const alternatives = splitAlternatives(token.slice(i + 1, close));
      if (alternatives.some((a) => /\s/.test(a) || /[<>[\]]/.test(a)))
        return {
          ok: false,
          error: `inline alternation may only hold plain literals: "${token}"`,
        };
      pattern += `(?:${alternatives.map(escapeLiteral).join("|")})`;
      i = close + 1;
      continue;
    }
    pattern += escapeLiteral(ch);
    i++;
  }
  return {
    ok: true,
    value: {
      kind: "token",
      source: token,
      regex: new RegExp(`^${pattern}$`),
      placeholders,
    },
  };
}

function matchingBracket(text: string, open: number): number {
  const closer = text[open] === "(" ? ")" : "]";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) return text[i] === closer ? i : -1;
    }
  }
  return -1;
}

function parseElements(tokens: string[]): ParseResult<Element[]> {
  const elements: Element[] = [];
  for (const token of tokens) {
    const optional = token.startsWith("[");
    const repeat = token.endsWith("...");
    const body = repeat ? token.slice(0, -3) : token;
    if (optional || body.startsWith("(")) {
      const close = matchingBracket(body, 0);
      if (close !== body.length - 1)
        return {
          ok: false,
          error: `a group must span the whole token: "${token}"`,
        };
      const alternatives: Element[][] = [];
      for (const alt of splitAlternatives(body.slice(1, close))) {
        const split = splitTokens(alt);
        if (!split.ok) return split;
        const parsed = parseElements(split.value);
        if (!parsed.ok) return parsed;
        alternatives.push(parsed.value);
      }
      elements.push({ kind: "group", alternatives, optional, repeat });
      continue;
    }
    if (repeat)
      return {
        ok: false,
        error: `"..." may only follow a group: "${token}"`,
      };
    const parsed = parseToken(body);
    if (!parsed.ok) return parsed;
    elements.push(parsed.value);
  }
  return { ok: true, value: elements };
}

export function parseCommandPattern(run: string): ParseResult<ParsedPattern> {
  const tokens = splitTokens(run);
  if (!tokens.ok) return tokens;
  if (tokens.value.length === 0)
    return { ok: false, error: "empty command pattern" };
  const first = tokens.value[0]!;
  if (/[<>[\]()|]/.test(first))
    return {
      ok: false,
      error: `the first token must be a literal — "${first}" is not. A pattern that lets the caller choose the program is a shell, not an allowlist`,
    };
  const elements = parseElements(tokens.value);
  if (!elements.ok) return elements;
  return {
    ok: true,
    value: {
      source: run,
      elements: elements.value,
      dashDashAt: tokens.value.indexOf("--"),
    },
  };
}

function validateCapture(
  value: string,
  placeholder: Placeholder,
  afterDashDash: boolean,
): string | null {
  if (!afterDashDash && value.startsWith("-"))
    return `<${placeholder.identifier}> may not begin with "-" before a literal "--"`;
  const format = placeholder.format;
  if (format.kind === "path" && value.split("/").includes(".."))
    return `<${placeholder.identifier}> may not contain a ".." segment`;
  if (format.kind === "int") {
    const n = Number(value);
    if (n < format.min || (format.max !== null && n > format.max))
      return `<${placeholder.identifier}> must be in ${format.min}-${format.max ?? "∞"}`;
  }
  return null;
}

interface MatchState {
  argv: string[];
  dashDashSeen: boolean[];
  furthest: number;
  failure: string | null;
}

function matchToken(
  element: TokenElement,
  state: MatchState,
  at: number,
): boolean {
  const arg = state.argv[at];
  if (arg === undefined) return false;
  const found = element.regex.exec(arg);
  if (!found) return false;
  for (let i = 0; i < element.placeholders.length; i++) {
    const problem = validateCapture(
      found[i + 1] ?? "",
      element.placeholders[i]!,
      state.dashDashSeen[at] ?? false,
    );
    if (problem) {
      state.failure ??= problem;
      return false;
    }
  }
  return true;
}

type Continuation = (at: number) => boolean;

function matchSequence(
  elements: Element[],
  index: number,
  state: MatchState,
  at: number,
  cont: Continuation,
): boolean {
  if (at > state.furthest) state.furthest = at;
  if (index === elements.length) return cont(at);
  const element = elements[index]!;
  const next: Continuation = (end) =>
    matchSequence(elements, index + 1, state, end, cont);

  if (element.kind === "token") {
    if (!matchToken(element, state, at)) return false;
    return next(at + 1);
  }

  for (const alternative of element.alternatives) {
    const fromRepeat = (start: number, count: number): boolean =>
      matchSequence(alternative, 0, state, start, (end) => {
        if (end === start) return false;
        if (next(end)) return true;
        return (
          element.repeat && count + 1 < MAX_REPEAT && fromRepeat(end, count + 1)
        );
      });
    if (fromRepeat(at, 0)) return true;
  }
  return element.optional ? next(at) : false;
}

export interface CommandMatch {
  ok: true;
  index: number;
  pattern: ParsedPattern;
}

export interface CommandRefusal {
  ok: false;
  reason: string;
  closest: string | null;
}

function markDashDash(argv: string[]): boolean[] {
  const marks: boolean[] = [];
  let seen = false;
  for (const arg of argv) {
    marks.push(seen);
    if (arg === "--") seen = true;
  }
  return marks;
}

export function matchCommand(
  patterns: ParsedPattern[],
  argv: string[],
): CommandMatch | CommandRefusal {
  if (argv.length === 0)
    return { ok: false, reason: "empty command", closest: null };
  if (argv.length > MAX_ARGV_LENGTH)
    return {
      ok: false,
      reason: `command has ${argv.length} arguments (max ${MAX_ARGV_LENGTH})`,
      closest: null,
    };
  const tooLong = argv.find((arg) => arg.length > MAX_ARG_LENGTH);
  if (tooLong !== undefined)
    return {
      ok: false,
      reason: `an argument exceeds ${MAX_ARG_LENGTH} characters`,
      closest: null,
    };

  const dashDashSeen = markDashDash(argv);
  let best: {
    furthest: number;
    pattern: ParsedPattern;
    failure: string | null;
  } | null = null;
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!;
    const state: MatchState = {
      argv,
      dashDashSeen,
      furthest: 0,
      failure: null,
    };
    const matched = matchSequence(
      pattern.elements,
      0,
      state,
      0,
      (end) => end === argv.length,
    );
    if (matched) return { ok: true, index: i, pattern };
    if (best === null || state.furthest > best.furthest)
      best = { furthest: state.furthest, pattern, failure: state.failure };
  }

  if (best === null || best.furthest === 0)
    return {
      ok: false,
      reason: `no command pattern starts with "${argv[0]}"`,
      closest: null,
    };
  const reason =
    best.failure ??
    `matched up to "${argv.slice(0, best.furthest).join(" ")}" then ${
      best.furthest >= argv.length
        ? "the pattern expected more arguments"
        : `"${argv[best.furthest]}" was not permitted there`
    }`;
  return { ok: false, reason, closest: best.pattern.source };
}
