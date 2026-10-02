import { at, type PlatformOutput } from "../platform";
import { NotFound } from "../trpc-server";

/**
 * The starter kit catalogs a default install reads, mirrored from the real
 * sources rather than invented:
 *
 * - `platform` — the built-in catalog, `helm/starter-kits/catalog.yaml` and
 *   `helm/starter-kits/kits/<id>/kit.yaml`, filtered by
 *   `starterKits.builtin.kits` in `helm/values.yaml` (evox and
 *   software-developer are disabled there, so they never reach the UI).
 *   `micro-manager` is a repository entry in that catalog
 *   (github.com/dam-agents/micro-manager, its own kit.yaml).
 * - `curated` — `starterKits.catalogs[0]` in `helm/values.yaml`,
 *   github.com/dam-agents/dam-starter-kits `catalog.yaml`, whose entries each
 *   carry their own kit.yaml (code-guardian, llm-wiki-v2, personal-assistant,
 *   plain-wiki).
 *
 * Shapes follow what the api-server's catalog refresh produces: a kit read
 * from the mounted chart directory has `version` = the app version and
 * `source` = the mount path; a kit read from a repository has `version` = the
 * resolved commit, `source` = `<gitUrl>#<sha>`, and a `seed: { self: true }`
 * rewritten to the repository url pinned at that commit.
 */

type Kit = PlatformOutput<"starterKits.list">[number];

const APP_VERSION = "0.2.19"; // helm/Chart.yaml appVersion
const BUILTIN_SOURCE = "/etc/platform/starter-kits";

const SHA = {
  microManager: "c6f8e53b8896c63988958085486e6d5bfbb83a73",
  codeGuardian: "42414104b5ba4412befbc73e6db6a608e8d9c496",
  llmWiki: "4a3a534e087ece032c29e38911a3fbdc0bc57fc9",
  personalAssistant: "6fb860235f7f03f211eb69342a364ae4235794ae",
  plainWiki: "de98fcad57b72b7e6f8ee9d8f2e8ad5229011c16",
};

const gh = (repo: string) => `https://github.com/dam-agents/${repo}`;

function kit(
  over: Omit<
    Partial<Kit>,
    "id" | "name" | "description" | "category" | "catalog"
  > &
    Pick<Kit, "id" | "name" | "description" | "category" | "catalog">,
): Kit {
  return {
    schemaVersion: "v1",
    version: APP_VERSION,
    source: BUILTIN_SOURCE,
    egressRules: [],
    connections: [],
    channels: [],
    schedules: [],
    skills: [],
    env: [],
    skillsInKit: [],
    ...over,
  };
}

/** A kit read from its own repository, seeded from itself at that commit. */
function repoKit(
  repo: string,
  sha: string,
  into: "work" | "home",
): Pick<Kit, "version" | "source" | "seed"> {
  return {
    version: sha,
    source: `${gh(repo)}#${sha}`,
    seed: { self: true, url: gh(repo), commit: sha, into },
  };
}

const GITHUB_FOR_RESULTS = {
  accepts: ["github", "github-enterprise"],
  required: false,
  note: "Needed to clone private target repositories and publish results.",
};

// ── platform (built-in) ─────────────────────────────────────────────

const nous = kit({
  catalog: "platform",
  id: "nous",
  name: "Nous",
  description:
    "Hypothesis-driven experimentation campaigns against a target system the agent clones, builds, patches and measures. Runs on the pre-built Nous image.",
  category: "research",
  icon: "microscope",
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/nous/README.md",
  onboarding: false,
  image: {
    ref: "quay.io/dam-agents/nous",
    harness: "claude-code",
    providers: ["ibm-litellm", "anthropic"],
  },
  resources: {
    cpu: "2",
    memory: "4Gi",
    storage: "10Gi",
    note: "A campaign clones, builds and runs the target system, with a git worktree per arm and its own Python environment — more CPU, memory and disk than a chat agent.",
  },
  connections: [GITHUB_FOR_RESULTS],
  hibernationTimeoutMin: 0,
});

const skyDiscover = {
  category: "research",
  icon: "chart",
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/skydiscover/README.md",
  onboarding: false,
  image: {
    ref: "quay.io/dam-agents/skydiscover",
    harness: "claude-code",
    providers: ["ibm-litellm", "openai"],
  },
  resources: { storage: "5Gi" },
  connections: [GITHUB_FOR_RESULTS],
} satisfies Partial<Kit>;

const openevolve = kit({
  catalog: "platform",
  id: "openevolve",
  name: "OpenEvolve",
  description:
    "Evolutionary code-optimization agent: evolves programs against a fitness function you define. Brings its own agent, built on Claude Code.",
  ...skyDiscover,
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/openevolve/README.md",
  image: { ...skyDiscover.image, ref: "quay.io/dam-agents/openevolve" },
});

const shinkaevolve = kit({
  catalog: "platform",
  id: "shinkaevolve",
  name: "ShinkaEvolve",
  description:
    "Sample-efficient evolutionary program-optimization agent. Brings its own agent, built on Claude Code.",
  ...skyDiscover,
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/shinkaevolve/README.md",
  image: { ...skyDiscover.image, ref: "quay.io/dam-agents/shinkaevolve" },
});

const gepa = kit({
  catalog: "platform",
  id: "gepa",
  name: "GEPA",
  description:
    "Reflective prompt and text-optimization agent. Brings its own agent, built on Claude Code.",
  category: "research",
  icon: "idea",
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/gepa/README.md",
  onboarding: false,
  image: {
    ref: "quay.io/dam-agents/gepa",
    harness: "claude-code",
    providers: ["ibm-litellm", "anthropic"],
  },
  resources: { storage: "5Gi" },
  connections: [GITHUB_FOR_RESULTS],
});

const adaevolve = kit({
  catalog: "platform",
  id: "adaevolve",
  name: "AdaEvolve",
  description:
    "Multi-island adaptive code and algorithm optimization (SkyDiscover). Brings its own agent, built on Claude Code.",
  ...skyDiscover,
  env: [{ name: "SKYDISCOVER_SEARCH", value: "adaevolve" }],
});

const kSearch = kit({
  catalog: "platform",
  id: "k-search",
  name: "K-Search",
  description:
    "LLM-driven GPU kernel optimization with evaluation on Modal. Brings its own agent.",
  category: "research",
  icon: "search",
  docsUrl:
    "https://github.com/dam-agents/dam/blob/main/packages/agents/k-search/README.md",
  onboarding: false,
  image: {
    ref: "quay.io/dam-agents/k-search",
    providers: ["ibm-litellm", "openai"],
  },
  resources: { cpu: "2", memory: "4Gi", storage: "5Gi" },
  connections: [
    {
      accepts: ["modal"],
      required: true,
      note: "Kernel evaluation runs on Modal cloud GPUs.",
    },
  ],
});

const microManager = kit({
  catalog: "platform",
  ...repoKit("micro-manager", SHA.microManager, "home"),
  id: "micro-manager",
  name: "Micro Manager",
  description:
    "Reads the messages you send on Slack throughout the day and keeps a list of everything you've asked someone to do. Each task stays on the list until you mark it done, so nothing you handed off slips through the cracks.",
  tagline: "Never lose track of what you asked someone to do in Slack.",
  category: "productivity",
  icon: "users",
  harnesses: ["claude-code", "bob"],
  docsUrl: gh("micro-manager"),
  onboarding: {
    prompt:
      "Read ONBOARDING.md in your home directory and follow it to the end. It asks whose Slack is swept, checks the local task store works, writes work/CONFIG.md, and ends with a dry run that files nothing until the operator confirms it.",
  },
  connections: [
    {
      accepts: ["slack"],
      required: true,
      note: "Connect as the person whose hand-offs are tracked — the sweep reads their own sent messages. A bot account sees nothing useful here.",
    },
  ],
  schedules: [
    {
      name: "micro-manager-sweep",
      cron: "0 8-20 * * 1-5",
      enabled: true,
      sessionMode: "fresh",
      task: 'Sweep run. Follow CLAUDE.md → "Sweep run": confirm the Slack identity first, load the dedupe set with `tasks list` (open and closed), search your own messages back to last_sweep_at, judge each one, file only what is new, then update last_sweep_at and report.',
    },
  ],
});

// ── curated (github.com/dam-agents/dam-starter-kits) ────────────────

const REVIEW_TASK =
  'Review heartbeat. The precheck already ran preflight and found work: read the worklist JSON at the path its output names, and never run preflight.sh again this run. If the prompt carries no worklist path, run `bash "$HOME/scripts/preflight.sh" review` yourself. Then follow CLAUDE.md → "Review run": read docs/review.md and docs/skills.md, apply the bookkeeping arrays (self-heals, label cleanups, prunes), review every PR in reviews_due (chat UI + GitHub review with the marker; honour the HEAD-freshness checks, locks, and the re-review label gate, removing the label after posting), handle artifacts_due per docs/artifact.md, and back up work/ at the end (`scripts/work-backup.sh persist`).';
const REVIEW_PRECHECK = 'bash "$HOME/scripts/precheck.sh" review';

const codeGuardian = kit({
  catalog: "curated",
  ...repoKit("code-guardian", SHA.codeGuardian, "home"),
  id: "code-guardian",
  name: "Code Reviewer",
  description:
    "Reviews every open pull request in a repository on a heartbeat, posts one structured review per PR, re-reviews on a label, and can nudge human reviewers on Slack.",
  tagline: "Every pull request gets a review, within minutes.",
  category: "software",
  icon: "code",
  harnesses: ["claude-code", "bob"],
  docsUrl: gh("code-guardian"),
  onboarding: {
    prompt:
      "Read ONBOARDING.md in your home directory and follow it to the end. It asks for the state-backup repository (an existing one continues a previous agent) and the repository to review, writes the configuration, reconciles the schedules this kit registered, and ends with a summary for the operator.",
  },
  connections: [
    {
      accepts: ["github", "github-enterprise"],
      required: true,
      note: "Connect as a bot account (a GitHub App or a token for a machine user), not as the account that opens the pull requests it reviews.",
    },
    {
      accepts: ["slack"],
      required: false,
      note: "Used by the shepherd sweep, which is created disabled. Turn it on under Schedules once Slack is connected. The weekly audit runs without it and posts its report to Slack only when Slack is connected.",
    },
  ],
  channels: [
    {
      type: "slack",
      note: "Where reviewer nudges and the weekly audit report land once Slack is connected. Skip it to keep everything in chat.",
    },
  ],
  schedules: [
    {
      name: "code-guardian-review-active",
      cron: "*/5 8-21 * * 1-5",
      enabled: true,
      sessionMode: "fresh",
      precheck: REVIEW_PRECHECK,
      task: REVIEW_TASK,
    },
    {
      name: "code-guardian-review-quiet",
      cron: "0 22-23,0-7 * * 1-5",
      enabled: true,
      sessionMode: "fresh",
      precheck: REVIEW_PRECHECK,
      task: REVIEW_TASK,
    },
    {
      name: "code-guardian-review-offdays",
      cron: "0 * * * 6,0",
      enabled: true,
      sessionMode: "fresh",
      precheck: REVIEW_PRECHECK,
      task: REVIEW_TASK,
    },
    {
      name: "code-guardian-shepherd-1h-workdays",
      cron: "0 7-18 * * 1-5",
      enabled: false,
      sessionMode: "fresh",
      precheck: 'bash "$HOME/scripts/precheck.sh" shepherd',
      task: 'Shepherd sweep. The precheck already ran preflight and found nudges due: read the worklist JSON at the path its output names, and never run preflight.sh again this run. If the prompt carries no worklist path, run `bash "$HOME/scripts/preflight.sh" shepherd` yourself. Then follow CLAUDE.md → "Shepherd run": read docs/shepherd.md, send exactly the nudges in nudges_due to the shared Slack channel (roster-only mentions), apply each sent nudge\'s row_update to the ledger immediately after its send (send-then-record), and back up work/ (`scripts/work-backup.sh persist`).',
    },
    {
      name: "code-guardian-audit-weekly",
      cron: "0 7 * * 5",
      enabled: true,
      sessionMode: "fresh",
      task: 'Weekly audit. Run `bash "$HOME/scripts/preflight.sh" audit` first — this run is ungated. Follow CLAUDE.md → "Audit run": read docs/audit.md, add the agent-side checks (schedules, memory compliance, nudge integrity, reaction feedback), compose the health report from stats + checks, send it to Slack when slack_notifications is enabled (chat UI always), append the AUDIT.log line, and back up work/ (`scripts/work-backup.sh persist`).',
    },
    {
      name: "code-guardian-benchmark-monthly",
      cron: "0 6 1 * *",
      enabled: false,
      sessionMode: "fresh",
      precheck: 'bash "$HOME/scripts/precheck.sh" benchmark',
      task: 'Model benchmark. The precheck already ran preflight and found the benchmark due: read the worklist JSON at the path its output names, and never run preflight.sh again this run. If the prompt carries no worklist path, run `bash "$HOME/scripts/preflight.sh" benchmark` yourself. Then follow CLAUDE.md → "Benchmark run": read docs/benchmark.md and perform the action in benchmark_due — create_fixture tops the fixture set up to the full set (≥5) and ends the run; run replays every fixture review with the configured skills (time and tokens measured), scores them with scripts/benchmark-score.sh (plus the judge when configured), appends the results to work/benchmark/, regenerates and republishes the accumulated report, and reports the scores — and back up work/ (`scripts/work-backup.sh persist`).',
    },
    {
      name: "code-guardian-survey-weekly",
      cron: "30 3 * * 6",
      enabled: false,
      sessionMode: "fresh",
      precheck: 'bash "$HOME/scripts/precheck.sh" survey',
      task: 'Codebase survey. The precheck already ran preflight and found an area due: read the worklist JSON at the path its output names, and never run preflight.sh again this run. If the prompt carries no worklist path, run `bash "$HOME/scripts/preflight.sh" survey` yourself. Then follow CLAUDE.md → "Survey run": read docs/survey.md, prepare the area with `scripts/survey.sh prepare`, read exactly the files it lists, write the findings in the review form, record the pass with `scripts/survey.sh record`, regenerate and republish the accumulated report, and back up work/ (`scripts/work-backup.sh persist`).',
    },
  ],
  bundledSkills: { path: ".agents/skills" },
  skillsInKit: [
    {
      name: "issue-fit",
      description:
        'Review-time check that a pull request delivers what its linked GitHub issue asked: resolves the issue from the PR (closing keywords, branch name), reads the issue body and comments for the actual ask, and flags missing scope and undeclared scope creep. REST-only and repo-agnostic. Use when reviewing a PR to verify it does what was asked — "issue fit", "does this PR deliver the issue".',
    },
    {
      name: "review-remediation",
      description:
        "Answer an automated code review on a pull request so the next round approves: read the review's machine-readable findings and checks, fix every blocking finding at every location of its class, ask the caller about the ones a recorded decision makes disputable, self-review the push the way the reviewer will, run the checks the review supplies, and answer in one reply.",
    },
  ],
});

const llmWiki = kit({
  catalog: "curated",
  ...repoKit("llm-wiki-v2", SHA.llmWiki, "work"),
  id: "llm-wiki",
  name: "LLM Wiki",
  description:
    "A knowledge base agent that builds a structured wiki with a knowledge graph, from the llm-wiki toolkit. Point it at repos and documents, then ask it questions.",
  category: "knowledge",
  icon: "chart",
  knowledgeBase: { shareRoots: ["wiki"] },
  install: { command: "bash bootstrap.sh" },
  providers: ["ibm-litellm", "anthropic", "openai"],
});

const personalAssistant = kit({
  catalog: "curated",
  ...repoKit("personal-assistant", SHA.personalAssistant, "home"),
  id: "personal-assistant",
  name: "Personal Assistant",
  description:
    "Serves exactly one person: keeps their task list, answers their questions and drafts text in a direct message conversation, and — when they opt in — sends a weekday morning brief and a Monday review. Who it is and what it takes care of are written by its owner in a short interview at first run, not shipped here.",
  category: "productivity",
  icon: "user",
  harnesses: ["claude-code", "codex", "bob"],
  docsUrl: gh("personal-assistant"),
  connections: [
    {
      accepts: ["slack", "telegram"],
      required: true,
      note: "The one conversation this assistant lives in. It writes to a single person — the owner pastes their member ID during onboarding — and never to a group.",
    },
    {
      accepts: ["github", "github-enterprise"],
      required: false,
      note: "Recommended, not required. Read, and pull requests, on this definition repository: the agent checks its own version and proposes changes to itself. Point GITHUB_REPO_WORK at a private repository to also back up work/ — without one, the owner's tasks and notes exist on the volume and nowhere else. A definition repo off github.com also needs DEF_HOST. Without this connection the agent runs local-only: it serves its owner in full, but cannot check its version, update itself, open a pull request, or back anything up. Granting it later needs no migration.",
    },
  ],
  channels: [
    {
      type: "slack",
      note: "A direct message conversation, not a shared channel — this agent serves one person. Telegram works the same way when that is the connection you granted.",
    },
  ],
  schedules: [
    {
      name: "personal-assistant-brief-weekday",
      cron: "0 8 * * 1-5",
      enabled: true,
      sessionMode: "fresh",
      task: "Morning brief: run the brief pre-flight, then send it. Entry command and full procedure: ONBOARDING.md Step 4.",
    },
    {
      name: "personal-assistant-review-weekly",
      cron: "30 8 * * 1",
      enabled: true,
      sessionMode: "fresh",
      task: "Weekly review: run the review pre-flight, then send it. Entry command and full procedure: ONBOARDING.md Step 4.",
    },
    {
      name: "personal-assistant-audit-weekly",
      cron: "0 7 * * 5",
      enabled: true,
      sessionMode: "fresh",
      task: "Weekly audit: run the audit pre-flight, then report traffic-light. Entry command and full procedure: ONBOARDING.md Step 4.",
    },
  ],
});

const plainWiki = kit({
  catalog: "curated",
  ...repoKit("plain-wiki", SHA.plainWiki, "work"),
  id: "plain-wiki",
  name: "Plain Wiki",
  description:
    "A knowledge base agent that keeps markdown files and organizes them for you. Lightweight, and works with no network beyond the model.",
  category: "knowledge",
  icon: "document",
  knowledgeBase: { shareRoots: ["wiki", "sources"] },
  install: { command: "bash bootstrap.sh" },
  providers: ["ibm-litellm", "anthropic", "openai"],
});

/** Catalog order: built-in first, then external catalogs in values order. */
export const KITS: Kit[] = [
  nous,
  openevolve,
  shinkaevolve,
  gepa,
  adaevolve,
  kSearch,
  microManager,
  codeGuardian,
  llmWiki,
  personalAssistant,
  plainWiki,
];

export const kitsEntries = [
  // The catalog is install-wide, not per-user: a new account sees it too.
  at("starterKits.list", () => KITS),
  at("starterKits.get", ({ catalog, id }) => {
    const found = KITS.find((k) => k.catalog === catalog && k.id === id);
    if (!found) throw new NotFound();
    return found;
  }),
];
