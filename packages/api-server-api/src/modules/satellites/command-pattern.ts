export const MAX_ARG_LENGTH = 4096;
export const MAX_ARGV_LENGTH = 64;
export const MAX_REPEAT = 16;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface TokenElement {
  kind: "token";
  source: string;
  regex: RegExp;
  open: boolean;
  openAtStart: boolean;
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

const SEGMENT = "[A-Za-z0-9._-]+";
const STAR = "[A-Za-z0-9._-]*";
const DOUBLE_STAR = "[A-Za-z0-9._\\-/]*";

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function isRegexToken(token: string): boolean {
  return token.startsWith("^") && token.endsWith("$") && token.length > 1;
}

function parseToken(token: string): ParseResult<TokenElement> {
  if (isRegexToken(token)) {
    const body = token.slice(1, -1);
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${body})$`);
    } catch (err) {
      return {
        ok: false,
        error: `invalid regex ${token}: ${(err as Error).message}`,
      };
    }
    return {
      ok: true,
      value: {
        kind: "token",
        source: token,
        regex,
        open: true,
        openAtStart: false,
      },
    };
  }
  if (token.includes("^") || token.includes("$"))
    return {
      ok: false,
      error: `a regex must be the whole argument, anchored with ^ and $: "${token}"`,
    };

  let pattern = "";
  let wildcards = 0;
  let openAtStart = false;
  let i = 0;
  while (i < token.length) {
    const ch = token[i]!;
    if (ch === "*") {
      const double = token[i + 1] === "*";
      if (i === 0) openAtStart = true;
      if (double && token[i + 2] === "/") {
        pattern += `(?:${SEGMENT}/)*`;
        i += 3;
      } else {
        pattern += double ? DOUBLE_STAR : STAR;
        i += double ? 2 : 1;
      }
      wildcards++;
      continue;
    }
    if (ch === "(") {
      const close = matchingBracket(token, i);
      if (close === -1)
        return { ok: false, error: `unbalanced "(" in "${token}"` };
      const alternatives = splitAlternatives(token.slice(i + 1, close));
      if (alternatives.some((a) => /[\s[\]*]/.test(a)))
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
      open: wildcards > 0,
      openAtStart,
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
    if (optional || (body.startsWith("(") && !isRegexToken(body))) {
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
      return { ok: false, error: `"..." may only follow a group: "${token}"` };
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
  if (/[*[\]()|^$]/.test(first))
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

interface MatchState {
  argv: string[];
  dashDashSeen: boolean[];
  furthest: number;
  failure: string | null;
}

function checkValue(
  element: TokenElement,
  arg: string,
  state: MatchState,
  at: number,
): string | null {
  if (
    element.openAtStart &&
    !(state.dashDashSeen[at] ?? false) &&
    arg.startsWith("-")
  )
    return `"${arg}" may not begin with "-" before a literal "--"`;
  if (arg.split("/").includes(".."))
    return `"${arg}" may not contain a ".." segment`;
  return null;
}

function matchToken(
  element: TokenElement,
  state: MatchState,
  at: number,
): boolean {
  const arg = state.argv[at];
  if (arg === undefined) return false;
  if (!element.regex.test(arg)) return false;
  if (!element.open) return true;
  const problem = checkValue(element, arg, state, at);
  if (problem !== null) {
    state.failure ??= problem;
    return false;
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
