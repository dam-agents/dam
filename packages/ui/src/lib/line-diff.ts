export interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
}

export type DiffRow = DiffLine | { kind: "gap"; count: number };

const MAX_LCS_CELLS = 1_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_LCS_CELLS)
    return [
      ...a.map((text): DiffLine => ({ kind: "removed", text })),
      ...b.map((text): DiffLine => ({ kind: "added", text })),
    ];
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const context = (text: string): DiffLine => ({ kind: "context", text });
  return [
    ...a.slice(0, start).map(context),
    ...lcsDiff(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(context),
  ];
}

export function collapseContext(lines: DiffLine[], keep = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "context") {
      rows.push(lines[i++]);
      continue;
    }
    let runEnd = i;
    while (runEnd < lines.length && lines[runEnd].kind === "context") runEnd++;
    const head = i === 0 ? 0 : keep;
    const tail = runEnd === lines.length ? 0 : keep;
    if (runEnd - i > head + tail + 1) {
      rows.push(...lines.slice(i, i + head));
      rows.push({ kind: "gap", count: runEnd - i - head - tail });
      rows.push(...lines.slice(runEnd - tail, runEnd));
    } else {
      rows.push(...lines.slice(i, runEnd));
    }
    i = runEnd;
  }
  return rows;
}
