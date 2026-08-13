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
  if (sessionId && runtime) {
    const tasks = Array.isArray(payload.background_tasks)
      ? payload.background_tasks
      : [];
    const items = tasks
      .filter((task) => typeof task?.id === "string" && task.id)
      .map((task) => ({
        id: task.id,
        ...(task.description
          ? { description: String(task.description).slice(0, 200) }
          : {}),
        ...(task.command
          ? { command: String(task.command).slice(0, 500) }
          : {}),
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
}

process.exit(0);
