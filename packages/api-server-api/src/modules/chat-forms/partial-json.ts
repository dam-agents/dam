type Expect = "key" | "colon" | "value" | "comma";

interface Frame {
  close: "]" | "}";
  expect: Expect;
}

const SCALAR_END = /[\s,\]}]/;

function closers(stack: readonly Frame[]): string {
  return stack
    .map((frame) => frame.close)
    .reverse()
    .join("");
}

export function parsePartialJson(text: string): unknown {
  const stack: Frame[] = [];
  let safeEnd = -1;
  let safeClosers = "";
  let pos = 0;

  const markSafe = (end: number) => {
    safeEnd = end;
    safeClosers = closers(stack);
  };
  const valueDone = (end: number) => {
    const frame = stack[stack.length - 1];
    if (!frame) {
      markSafe(end);
      return;
    }
    frame.expect = "comma";
    markSafe(end);
  };

  while (pos < text.length) {
    const char = text[pos];
    const frame = stack[stack.length - 1];
    if (/\s/.test(char)) {
      pos += 1;
      continue;
    }
    if (char === '"') {
      let end = pos + 1;
      while (end < text.length && text[end] !== '"')
        end += text[end] === "\\" ? 2 : 1;
      if (end >= text.length) break;
      pos = end + 1;
      if (frame?.close === "}" && frame.expect === "key")
        frame.expect = "colon";
      else valueDone(pos);
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push({
        close: char === "{" ? "}" : "]",
        expect: char === "{" ? "key" : "value",
      });
      pos += 1;
      markSafe(pos);
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      pos += 1;
      valueDone(pos);
      continue;
    }
    if (char === ":") {
      if (frame) frame.expect = "value";
      pos += 1;
      continue;
    }
    if (char === ",") {
      if (frame) frame.expect = frame.close === "}" ? "key" : "value";
      pos += 1;
      continue;
    }
    let end = pos;
    while (end < text.length && !SCALAR_END.test(text[end])) end += 1;
    if (end >= text.length) break;
    pos = end;
    valueDone(pos);
  }

  if (safeEnd < 0) return undefined;
  try {
    return JSON.parse(text.slice(0, safeEnd) + safeClosers);
  } catch {
    return undefined;
  }
}
