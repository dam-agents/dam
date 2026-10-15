export interface PushEntry {
  sha: string;
  at: number;
}

export interface PushedRef {
  remote: string;
  branch: string;
}

const REFLOG_LINE = /^[0-9a-f]+ ([0-9a-f]+) .*> (\d+) [+-]\d{4}\t(.*)$/;

export function pushEntriesIn(text: string): PushEntry[] {
  return text.split("\n").flatMap((line) => {
    const match = REFLOG_LINE.exec(line);
    return match && match[3] === "update by push"
      ? [{ sha: match[1]!, at: Number(match[2]) * 1000 }]
      : [];
  });
}

export function completeLinesOf(text: string): string {
  return text.slice(0, text.lastIndexOf("\n") + 1);
}

export function pushedRefOf(logPath: string): PushedRef | null {
  const slash = logPath.indexOf("/");
  if (slash <= 0 || slash === logPath.length - 1) return null;
  const branch = logPath.slice(slash + 1);
  return branch === "HEAD" ? null : { remote: logPath.slice(0, slash), branch };
}
