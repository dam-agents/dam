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
