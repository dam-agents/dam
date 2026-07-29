// Stop / SubagentStop hook: report this session's in-flight background work to
// agent-runtime, which keeps the session (and the pod) alive while it runs.
//
// Claude Code hands every Stop hook the session's own live task registry in
// `background_tasks` — "In-flight background work (running/pending +
// backgrounded) registered in this session" — which is exactly the level the
// platform's background-work contract wants. The hook fires again when a
// finishing background task wakes the model for a followup turn, and that Stop
// carries the now-empty set: the release edge.
//
// `session_id` is the CLI's session id, which the ACP adapter spawns the CLI
// with (`--session-id`), so it is the platform's session id too — no mapping.
//
// This hook must never affect the agent: it prints nothing, exits 0 whatever
// happens, and gives up quickly if the runtime doesn't answer.
import process from "node:process";

const TIMEOUT_MS = 2_000;

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(""));
  });
}

try {
  const payload = JSON.parse((await readStdin()) || "{}");
  const sessionId = payload.session_id;
  const runtime = process.env.PLATFORM_RUNTIME_URL;
  // No session or no runtime to tell: nothing to do. An image running outside
  // the platform (bare `claude` on a laptop) takes this path.
  if (sessionId && runtime) {
    const tasks = Array.isArray(payload.background_tasks)
      ? payload.background_tasks
      : [];
    const items = tasks
      .filter((task) => typeof task?.id === "string" && task.id)
      .map((task) => ({
        id: task.id,
        // Both are advisory, and the contract truncates them anyway.
        ...(task.description ? { description: String(task.description) } : {}),
        ...(task.command ? { command: String(task.command) } : {}),
      }));
    await fetch(
      `${runtime}/api/sessions/${encodeURIComponent(sessionId)}/background-work`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  }
} catch {
  // Reporting is best-effort: a report that never lands leaves the platform
  // where it was before this hook existed. Never block the agent for it.
}

process.exit(0);
