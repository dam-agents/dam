/**
 * Extract `name` and `description` from a SKILL.md's YAML frontmatter.
 * Handles plain scalars (`description: foo`), folded block scalars
 * (`description: >`), and literal block scalars (`description: |`) —
 * some catalogs use `>` with line continuations, which a naive parser
 * surfaces as the literal character `>`.
 */
export function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1] as "name" | "description";
    const raw = m[2].trim();

    // Block scalars — `>` (folded, lines joined with a space) or `|` (literal,
    // lines joined with newlines). The header line itself has no content; the
    // value lives in the following indented lines.
    const blockMatch = /^([>|])[+-]?$/.exec(raw);
    if (blockMatch) {
      const folded = blockMatch[1] === ">";
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const line = lines[j];
        if (line.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        if (!/^\s+/.test(line)) break;
        collected.push(line.replace(/^\s+/, ""));
        j++;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "")
        collected.pop();
      out[key] = folded ? collected.join(" ") : collected.join("\n");
      i = j - 1;
      continue;
    }

    const unquoted = raw.replace(/^["']|["']$/g, "");
    if (unquoted) out[key] = unquoted;
  }
  return out;
}

/** A conservatively "safe" plain YAML scalar: starts alphanumeric, then only
 *  characters that carry no YAML meaning. Anything else (`:`, `#`, quotes,
 *  newlines, control chars, leading punctuation, non-ASCII) must be quoted. */
const SAFE_PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 _.()-]*$/;

/** Render `value` as a YAML scalar: plain when safe (so common names stay
 *  human-readable), else double-quoted with JSON escaping — valid YAML flow
 *  syntax that also neutralizes `:`/`#`/newline/control-char hazards. */
function yamlScalar(value: string): string {
  return SAFE_PLAIN_SCALAR.test(value) ? value : JSON.stringify(value);
}

/**
 * Force a SKILL.md's top-level frontmatter `name:` to `name`, so an uploaded
 * skill lists under exactly the name the user confirmed. With no frontmatter
 * block, prepend a minimal one; with a block, rewrite its `name:` entry (or
 * insert it as the first line when absent). Every other byte is preserved.
 *
 * The value is emitted as a YAML-safe scalar (plain when simple, else
 * double-quoted + escaped) so the harness's real YAML parser loads it and no
 * `:`/`#`/newline can break the block or inject a second line.
 * `parseFrontmatter` (the read side) strips at most one surrounding quote, so
 * both forms round-trip for every realistic display name.
 *
 * The fence regex is the capture-group split of `parseFrontmatter`'s block
 * matcher, so the two can never disagree on what counts as frontmatter.
 */
export function ensureFrontmatterName(content: string, name: string): string {
  const line = `name: ${yamlScalar(name)}`;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(content);
  if (!m) return `---\n${line}\n---\n\n${content}`;

  const [full, open, body, close] = m;
  const nl = open.includes("\r\n") ? "\r\n" : "\n";
  const bodyLines = body.length > 0 ? body.split(/\r?\n/) : [];
  const nameIdx = bodyLines.findIndex((l) => /^name:\s*/.test(l));
  if (nameIdx >= 0) {
    // A block scalar (`name: |`), a folded one (`name: >`), or a multi-line
    // plain scalar carries its value in the following indented lines. Replacing
    // only the header line leaves those orphaned, and a real YAML parser folds
    // them into the name we just wrote — so the harness would load a different
    // name than the one the user confirmed.
    let end = nameIdx + 1;
    while (end < bodyLines.length && /^\s+\S/.test(bodyLines[end])) end++;
    bodyLines.splice(nameIdx, end - nameIdx, line);
  } else bodyLines.unshift(line);

  const rebuilt = open + bodyLines.join(nl) + close;
  return (
    content.slice(0, m.index) + rebuilt + content.slice(m.index + full.length)
  );
}
