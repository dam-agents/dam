import { A2uiExpressionError, toText } from "./values.js";

export interface ExpressionHost {
  read: (path: string) => unknown;
  call: (name: string, args: Record<string, unknown>) => unknown;
}

const IDENT = /[@A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const PATH_END = new Set(["}", ",", ")", " ", "\t", "\n"]);

class ExpressionParser {
  constructor(
    private readonly text: string,
    public pos: number,
    private readonly host: ExpressionHost,
  ) {}

  private fail(message: string): never {
    throw new A2uiExpressionError(
      "EXPRESSION_ERROR",
      `formatString: ${message} at position ${this.pos}`,
    );
  }

  private skipSpace() {
    while (/\s/.test(this.text[this.pos] ?? "")) this.pos += 1;
  }

  expect(char: string) {
    this.skipSpace();
    if (this.text[this.pos] !== char) this.fail(`expected "${char}"`);
    this.pos += 1;
  }

  expression(): unknown {
    this.skipSpace();
    const char = this.text[this.pos];
    if (char === undefined) this.fail("unexpected end of expression");
    if (this.text.startsWith("${", this.pos)) {
      this.pos += 2;
      const value = this.expression();
      this.expect("}");
      return value;
    }
    if (char === "'" || char === '"') return this.quoted(char);
    IDENT.lastIndex = this.pos;
    const ident = IDENT.exec(this.text);
    if (ident) {
      const after = this.pos + ident[0].length;
      let look = after;
      while (/\s/.test(this.text[look] ?? "")) look += 1;
      if (this.text[look] === "(") {
        this.pos = look + 1;
        return this.host.call(ident[0], this.arguments());
      }
    }
    return this.token();
  }

  private quoted(quote: string): string {
    let out = "";
    this.pos += 1;
    while (this.pos < this.text.length && this.text[this.pos] !== quote) {
      if (this.text[this.pos] === "\\") this.pos += 1;
      out += this.text[this.pos] ?? "";
      this.pos += 1;
    }
    if (this.text[this.pos] !== quote) this.fail("unterminated string");
    this.pos += 1;
    return out;
  }

  private arguments(): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    this.skipSpace();
    if (this.text[this.pos] === ")") {
      this.pos += 1;
      return args;
    }
    for (;;) {
      this.skipSpace();
      IDENT.lastIndex = this.pos;
      const name = IDENT.exec(this.text);
      if (!name) this.fail("expected a named argument");
      this.pos += name[0].length;
      this.expect(":");
      args[name[0]] = this.expression();
      this.skipSpace();
      if (this.text[this.pos] === ",") {
        this.pos += 1;
        continue;
      }
      this.expect(")");
      return args;
    }
  }

  private token(): unknown {
    const start = this.pos;
    while (this.pos < this.text.length && !PATH_END.has(this.text[this.pos]))
      this.pos += 1;
    const token = this.text.slice(start, this.pos);
    if (token === "") this.fail("expected a value");
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (NUMBER.test(token)) return Number(token);
    return this.host.read(token);
  }
}

export function formatString(template: string, host: ExpressionHost): string {
  let out = "";
  let pos = 0;
  while (pos < template.length) {
    if (template.startsWith("\\${", pos)) {
      out += "${";
      pos += 3;
    } else if (template.startsWith("${", pos)) {
      const parser = new ExpressionParser(template, pos + 2, host);
      const value = parser.expression();
      parser.expect("}");
      out += toText(value);
      pos = parser.pos;
    } else {
      out += template[pos];
      pos += 1;
    }
  }
  return out;
}
