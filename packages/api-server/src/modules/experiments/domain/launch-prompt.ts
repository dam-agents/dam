export function buildLaunchPrompt(input: {
  name: string;
  experimentId: string;
  scriptPath: string;
}): string {
  const { name, experimentId, scriptPath } = input;
  return [
    `Execute the experiment "${name}" and keep the user posted in this session.`,
    "",
    `1. Run the experiment script at ${scriptPath} as a detached background process, with the environment variable PLATFORM_EXPERIMENT_ID set exactly as shown:`,
    "",
    `    setsid nohup env PLATFORM_EXPERIMENT_ID=${experimentId} python3 ${scriptPath} > ${scriptPath}.log 2>&1 &`,
    "",
    `2. Confirm it started (check the first lines of ${scriptPath}.log; if it failed to start, report that with the log lines and stop here).`,
    "",
    '3. Monitor it WITHOUT blocking your turn: if your harness supports background commands with completion notifications, use them — e.g. watch the log in a background task and check in every few minutes. The experiment SDK prefixes its progress lines with [experiment]: subagent spawns ("spawned <label> (<id>)"), their completions, and the final status. Post a short note in this session when something meaningful happens: subagents starting or finishing, a batch of iterations done, a new best score, an error appearing in the log.',
    "",
    "4. When the process exits, report the outcome here: final status, a one-paragraph summary of what the run achieved, and — if it failed — the last lines of the log. The run's results page is published automatically.",
    "",
    "Rules:",
    `- If you produce extra files worth keeping (reports, plots, summaries), publish them with your create_artifact tool passing experiment_id=${experimentId} — they then appear among this run's artifacts.`,
    "- Do NOT modify the experiment in this session — no edits to its script or dashboard and no plan re-registration, before or during the run. It executes exactly as reviewed; iterate in the build conversation afterwards, for the next run.",
    "- Never hold the script in a foreground command; all waiting happens in background tasks between your turns.",
    "- The platform already renders a live graph of this run; your reports are narration for the human, not data relay — keep them brief.",
  ].join("\n");
}
