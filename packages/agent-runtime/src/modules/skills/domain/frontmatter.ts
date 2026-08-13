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

const SAFE_PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 _.()-]*$/;

function yamlScalar(value: string): string {
  return SAFE_PLAIN_SCALAR.test(value) ? value : JSON.stringify(value);
}

export function ensureFrontmatterName(content: string, name: string): string {
  const line = `name: ${yamlScalar(name)}`;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(content);
  if (!m) return `---\n${line}\n---\n\n${content}`;

  const [full, open, body, close] = m;
  const nl = open.includes("\r\n") ? "\r\n" : "\n";
  const bodyLines = body.length > 0 ? body.split(/\r?\n/) : [];
  const nameIdx = bodyLines.findIndex((l) => /^name:\s*/.test(l));
  if (nameIdx >= 0) {
    let end = nameIdx + 1;
    while (end < bodyLines.length && /^\s+\S/.test(bodyLines[end])) end++;
    bodyLines.splice(nameIdx, end - nameIdx, line);
  } else bodyLines.unshift(line);

  const rebuilt = open + bodyLines.join(nl) + close;
  return (
    content.slice(0, m.index) + rebuilt + content.slice(m.index + full.length)
  );
}
