import { cn } from "@/lib/utils";

type DiffLayout = "unified" | "split";

interface MockDiffViewProps {
  patch: string;
  layout: DiffLayout;
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk";
  content: string;
  oldNum: number | null;
  newNum: number | null;
}

function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)/);
      if (m) {
        oldLine = parseInt(m[1], 10) - 1;
        const n = raw.match(/\+(\d+)/);
        newLine = n ? parseInt(n[1], 10) - 1 : oldLine;
      }
      lines.push({ type: "hunk", content: raw, oldNum: null, newNum: null });
    } else if (raw.startsWith("+")) {
      newLine++;
      lines.push({
        type: "add",
        content: raw.slice(1),
        oldNum: null,
        newNum: newLine,
      });
    } else if (raw.startsWith("-")) {
      oldLine++;
      lines.push({
        type: "del",
        content: raw.slice(1),
        oldNum: oldLine,
        newNum: null,
      });
    } else {
      oldLine++;
      newLine++;
      lines.push({
        type: "context",
        content: raw.startsWith(" ") ? raw.slice(1) : raw,
        oldNum: oldLine,
        newNum: newLine,
      });
    }
  }
  return lines;
}

function lineStyle(type: DiffLine["type"]) {
  switch (type) {
    case "add":
      return "bg-[#24a148]/8 dark:bg-[#42be65]/8";
    case "del":
      return "bg-[#dc2626]/8 dark:bg-[#fa4d56]/8";
    case "hunk":
      return "bg-muted text-muted-foreground";
    default:
      return "";
  }
}

function linePrefix(type: DiffLine["type"]) {
  switch (type) {
    case "add":
      return "+";
    case "del":
      return "-";
    default:
      return " ";
  }
}

function GutterCell({ num }: { num: number | null }) {
  return (
    <span className="inline-block w-10 select-none text-right text-muted-foreground/60">
      {num ?? ""}
    </span>
  );
}

function UnifiedView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="font-mono text-xs leading-5">
      {lines.map((line, i) => (
        <div key={i} className={cn("flex", lineStyle(line.type))}>
          {line.type === "hunk" ? (
            <span className="px-2 py-0.5 text-muted-foreground">
              {line.content}
            </span>
          ) : (
            <>
              <GutterCell num={line.oldNum} />
              <GutterCell num={line.newNum} />
              <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                {linePrefix(line.type)}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
                {line.content}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function SplitView({ lines }: { lines: DiffLine[] }) {
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "hunk") {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === "del") {
      const delStart = i;
      while (i < lines.length && lines[i].type === "del") i++;
      const addStart = i;
      while (i < lines.length && lines[i].type === "add") i++;
      const dels = lines.slice(delStart, addStart);
      const adds = lines.slice(addStart, i);
      const max = Math.max(dels.length, adds.length);
      for (let j = 0; j < max; j++) {
        left.push(j < dels.length ? dels[j] : null);
        right.push(j < adds.length ? adds[j] : null);
      }
    } else if (line.type === "add") {
      left.push(null);
      right.push(line);
      i++;
    } else {
      left.push(line);
      right.push(line);
      i++;
    }
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-border font-mono text-xs leading-5">
      <div>
        {left.map((line, idx) => (
          <div
            key={idx}
            className={cn("flex", line ? lineStyle(line.type) : "")}
          >
            {line ? (
              line.type === "hunk" ? (
                <span className="px-2 py-0.5 text-muted-foreground">
                  {line.content}
                </span>
              ) : (
                <>
                  <GutterCell num={line.oldNum} />
                  <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                    {linePrefix(line.type)}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
                    {line.content}
                  </span>
                </>
              )
            ) : (
              <span className="h-5" />
            )}
          </div>
        ))}
      </div>
      <div>
        {right.map((line, idx) => (
          <div
            key={idx}
            className={cn("flex", line ? lineStyle(line.type) : "")}
          >
            {line ? (
              line.type === "hunk" ? (
                <span className="px-2 py-0.5 text-muted-foreground">
                  {line.content}
                </span>
              ) : (
                <>
                  <GutterCell num={line.newNum} />
                  <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                    {linePrefix(line.type)}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
                    {line.content}
                  </span>
                </>
              )
            ) : (
              <span className="h-5" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MockDiffView({ patch, layout }: MockDiffViewProps) {
  const lines = parsePatch(patch);
  return layout === "split" ? (
    <SplitView lines={lines} />
  ) : (
    <UnifiedView lines={lines} />
  );
}
