import { createApiClient } from "./src/lib/api-client.js";
import { acceptTerms, getAccessToken } from "./src/lib/auth.js";

const step = (m) => console.log(`\n=== ${m}`);
const arg = process.argv[2];

const token = await getAccessToken();
const api = createApiClient(token);
await acceptTerms(api);

if (arg === "create-driver") {
  const created = await api.agents.create.mutate({
    name: "verify-exp-driver",
    templateId: "claude-code",
  });
  console.log(created.id);
  let state = "";
  for (let i = 0; i < 60 && state !== "running"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    state = (await api.agents.get.query({ id: created.id })).state;
  }
  console.log("state:", state);
  process.exit(state === "running" ? 0 : 1);
}

if (arg === "start-run") {
  const draftId = process.argv[3];
  const run = await api.experiments.startRun.mutate({ id: draftId });
  console.log(JSON.stringify(run));
  process.exit(0);
}

if (arg === "check-run") {
  const runId = process.argv[3];
  for (let i = 0; i < 40; i++) {
    const run = await api.experiments.get.query({ id: runId });
    console.log(run.status, run.error ?? "");
    if (run.status !== "running") {
      console.log(JSON.stringify(run, null, 2).slice(0, 1200));
      process.exit(run.status === "completed" ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.exit(1);
}

if (arg === "cleanup") {
  const agents = await api.agents.list.query();
  const mine = agents.find((a) => a.name === "verify-exp-driver");
  if (mine) {
    await api.agents.delete.mutate({ id: mine.id });
    console.log("deleted", mine.id);
  }
  process.exit(0);
}

step("usage: create-driver | start-run <draftId> | check-run <runId> | cleanup");
