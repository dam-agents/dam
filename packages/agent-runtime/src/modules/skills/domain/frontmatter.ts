/**
 * Extract `name` and `description` from a SKILL.md's YAML frontmatter.
 * Handles plain scalars (`description: foo`), folded block scalars
 * (`description: >`), and literal block scalars (`description: |`) —
 * apocohq's catalog uses `>` with line continuations, which a naive parser
 * surfaces as the literal character `>`.
 */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
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
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
      out[key] = folded ? collected.join(" ") : collected.join("\n");
      i = j - 1;
      continue;
    }

    const unquoted = raw.replace(/^["']|["']$/g, "");
    if (unquoted) out[key] = unquoted;
  }
  return out;
}
