import {
  ArrowLeft,
  ArrowRight,
  Checkmark,
  Close,
  Code,
  Connect,
  Lightning,
  LogoGithub,
  Search,
  SendAltFilled,
  Time,
} from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CardButton } from "@/components/ui/card-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Step = "type" | "setup" | "builder";

type AgentFocus = "coding" | "research";
type HarnessImage = "claude-code" | "codex" | "pi-agent" | "bob";
type ProviderType = "anthropic" | "ibm-litellm" | "openai";

interface AgentDraft {
  focus: AgentFocus | null;
  image: HarnessImage | null;
  name: string;
  description: string;
  provider: ProviderType | null;
  connections: string[];
  knowledgeBase: boolean;
  hibernation: "idle" | "never";
}

const INITIAL_DRAFT: AgentDraft = {
  focus: null,
  image: null,
  name: "",
  description: "",
  provider: null,
  connections: [],
  knowledgeBase: false,
  hibernation: "idle",
};

interface BuilderMessage {
  role: "agent" | "user";
  content: string;
}

export function CreateAgentFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("type");
  const [draft, setDraft] = useState<AgentDraft>(INITIAL_DRAFT);

  const goToSetup = () => setStep("setup");
  const goToBuilder = () => setStep("builder");
  const goBack = () => {
    if (step === "setup") setStep("type");
    else if (step === "builder") setStep("setup");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-200">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          {step !== "type" && (
            <Button variant="ghost" size="icon-sm" onClick={goBack}>
              <ArrowLeft size={16} />
            </Button>
          )}
          <h2 className="text-lg font-semibold text-foreground">
            {step === "type" && "Create agent"}
            {step === "setup" && "Configure"}
            {step === "builder" && "Build your agent"}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <Close size={16} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {step === "type" && (
          <TypeSelection draft={draft} setDraft={setDraft} onNext={goToSetup} />
        )}
        {step === "setup" && (
          <SetupForm draft={draft} setDraft={setDraft} onNext={goToBuilder} />
        )}
        {step === "builder" && (
          <ConversationalBuilder draft={draft} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

const HARNESS_IMAGES: {
  id: HarnessImage;
  name: string;
  provider: string;
  description: string;
}[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    provider: "Anthropic",
    description: "Default Claude Code agent with full tool use",
  },
  {
    id: "codex",
    name: "Codex",
    provider: "OpenAI",
    description: "OpenAI Codex coding agent",
  },
  {
    id: "pi-agent",
    name: "PI Agent",
    provider: "Multi-LLM",
    description: "Pi coding agent with multi-provider support",
  },
  {
    id: "bob",
    name: "Bob",
    provider: "IBM",
    description: "Bob shell agent for infrastructure tasks",
  },
];

function TypeSelection({
  draft,
  setDraft,
  onNext,
}: {
  draft: AgentDraft;
  setDraft: (d: AgentDraft) => void;
  onNext: () => void;
}) {
  const selectFocus = (focus: AgentFocus) => {
    setDraft({
      ...draft,
      focus,
      image: focus === "coding" ? "claude-code" : draft.image,
    });
  };

  const selectImage = (image: HarnessImage) => {
    setDraft({ ...draft, image });
  };

  const canProceed =
    draft.focus === "coding" ||
    (draft.focus === "research" && draft.image !== null);

  return (
    <div className="max-w-[640px] mx-auto px-6 py-12">
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-foreground mb-2">
          What kind of agent?
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose a focus area. You can always change this later.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <CardButton
          selected={draft.focus === "coding"}
          onClick={() => selectFocus("coding")}
          className="flex items-center gap-3 p-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Code size={16} className="text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Coding agent</p>
            <p className="text-sm text-muted-foreground">
              Write, review, and ship code
            </p>
          </div>
        </CardButton>

        <CardButton
          selected={draft.focus === "research"}
          onClick={() => selectFocus("research")}
          className="flex items-center gap-3 p-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Search size={16} className="text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Research agent
            </p>
            <p className="text-sm text-muted-foreground">
              Deep research and analysis
            </p>
          </div>
        </CardButton>
      </div>

      {draft.focus === "research" && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          <p className="text-sm font-medium text-foreground mb-3">
            Select a harness image
          </p>
          <div className="grid grid-cols-2 gap-3">
            {HARNESS_IMAGES.map((img) => (
              <CardButton
                key={img.id}
                selected={draft.image === img.id}
                onClick={() => selectImage(img.id)}
                className="flex flex-col items-start gap-2 p-4"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {img.name}
                  </p>
                  <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                    {img.provider}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {img.description}
                </p>
              </CardButton>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end mt-10">
        <Button disabled={!canProceed} onClick={onNext}>
          Continue <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}

const PROVIDERS: { id: ProviderType; name: string; description: string }[] = [
  {
    id: "ibm-litellm",
    name: "IBM LiteLLM",
    description: "Claude via watsonx-routed proxy",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Direct Anthropic API access",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-family models for Codex agents",
  },
];

const CONNECTIONS: { id: string; name: string; description: string }[] = [
  { id: "github", name: "GitHub", description: "Repos, PRs, and issues" },
  {
    id: "github-enterprise",
    name: "GitHub Enterprise",
    description: "Internal GHE instance",
  },
  { id: "modal", name: "Modal", description: "Serverless GPU compute" },
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Cluster access and manifests",
  },
];

function SetupForm({
  draft,
  setDraft,
  onNext,
}: {
  draft: AgentDraft;
  setDraft: (d: AgentDraft) => void;
  onNext: () => void;
}) {
  const canProceed = draft.name.trim().length > 0 && draft.provider !== null;

  const toggleConnection = (id: string) => {
    setDraft({
      ...draft,
      connections: draft.connections.includes(id)
        ? draft.connections.filter((c) => c !== id)
        : [...draft.connections, id],
    });
  };

  return (
    <div className="max-w-[560px] mx-auto px-6 py-12">
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-foreground mb-2">
          Configure your agent
        </h3>
        <p className="text-sm text-muted-foreground">
          Set up the basics — provider, connections, and lifecycle.
        </p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Name
            </label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. deploy-bot"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Description
              <span className="text-muted-foreground font-normal ml-1">
                (optional)
              </span>
            </label>
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="What does it do?"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((p) => (
              <CardButton
                key={p.id}
                selected={draft.provider === p.id}
                onClick={() => setDraft({ ...draft, provider: p.id })}
                className="flex flex-col items-start p-3"
              >
                <p className="text-sm font-medium text-foreground">{p.name}</p>
                <p className="text-[13px] text-muted-foreground leading-snug">
                  {p.description}
                </p>
              </CardButton>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Connections
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CONNECTIONS.map((conn) => (
              <button
                key={conn.id}
                type="button"
                onClick={() => toggleConnection(conn.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  draft.connections.includes(conn.id)
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-muted-foreground/30",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                  {conn.id.startsWith("github") ? (
                    <LogoGithub size={14} className="text-foreground" />
                  ) : (
                    <Connect size={14} className="text-foreground" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {conn.name}
                  </p>
                  <p className="text-[13px] text-muted-foreground truncate">
                    {conn.description}
                  </p>
                </div>
                {draft.connections.includes(conn.id) && (
                  <Checkmark
                    size={14}
                    className="ml-auto shrink-0 text-primary"
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Capabilities
          </label>
          <button
            type="button"
            onClick={() =>
              setDraft({ ...draft, knowledgeBase: !draft.knowledgeBase })
            }
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
              draft.knowledgeBase
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:border-muted-foreground/30",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Search size={16} className="text-foreground" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                Knowledge base
              </p>
              <p className="text-[13px] text-muted-foreground">
                Ground the agent in your docs, wikis, or internal content
              </p>
            </div>
            <span
              className={cn(
                "flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors",
                draft.knowledgeBase ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 rounded-full bg-white transition-transform",
                  draft.knowledgeBase && "translate-x-4",
                )}
              />
            </span>
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Lifecycle
          </label>
          <div className="grid grid-cols-2 gap-3">
            <CardButton
              selected={draft.hibernation === "idle"}
              onClick={() => setDraft({ ...draft, hibernation: "idle" })}
              className="flex items-start gap-3 p-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Time size={16} className="text-foreground" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Hibernate while idle
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Frees compute when not in use
                </p>
              </div>
            </CardButton>

            <CardButton
              selected={draft.hibernation === "never"}
              onClick={() => setDraft({ ...draft, hibernation: "never" })}
              className="flex items-start gap-3 p-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-light">
                <Lightning size={16} className="text-accent" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Always-on
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Instant response, holds compute
                </p>
              </div>
            </CardButton>
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-10">
        <Button disabled={!canProceed} onClick={onNext}>
          Start building <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}

const PREFILLED_CONVERSATION: BuilderMessage[] = [
  {
    role: "agent",
    content:
      "Let's build this agent together. First — what's your name and what do you do? Tell me about your role, your day-to-day, and what you wish you had more time for.",
  },
  {
    role: "user",
    content:
      "I'm Jamie, I'm a senior platform engineer at a series B startup. I lead our infrastructure team — 4 engineers. My day-to-day is a mix of PR reviews, incident response, managing our deploy pipeline, and writing design docs for new infra. I spend way too much time on repetitive review cycles and writing status updates.",
  },
  {
    role: "agent",
    content:
      "Got it, Jamie. Senior platform eng, leading a team of 4, heavy on reviews and deploys. A few follow-ups:\n\nWho are your teammates? And what does your current task list look like — I can pull from GitHub if you'd like to connect a repo, or you can just tell me what's on your plate.",
  },
  {
    role: "user",
    content:
      "Team is me, Sarah (SRE focus), Marcus (networking/mesh), and Dev (observability). Current tasks — we're migrating our service mesh from Linkerd to Istio, I have 6 open PRs to review, and we're overdue on a post-mortem from last week's outage. I don't want to connect GitHub yet, maybe later.",
  },
  {
    role: "agent",
    content:
      "Noted — I've added your team context and current workload. No GitHub for now, we can always connect it later.\n\nNow tell me about how you work. What does a good output from you look like? Think: design docs you've written, runbook formats, how you do reviews. If you have examples — past docs, screenshots of your process, recordings — you can drop them here and I'll learn from the patterns.",
  },
  {
    role: "user",
    content:
      "My design docs follow a standard format: context, problem statement, proposed solution with alternatives considered, migration plan, and rollback strategy. For PR reviews I focus on correctness first, then performance, then style — I leave inline comments and always summarize at the top. For post-mortems I use the blameless format: timeline, contributing factors, action items with owners.",
  },
  {
    role: "agent",
    content:
      "That's really clear — I can model your review style and doc structure. I've captured your working patterns.\n\nBased on what you've told me, here are some schedules I think would help:\n\n• **Morning PR triage** — Every weekday at 8:30 AM, review open PRs and leave a summary of what needs attention\n• **Weekly status digest** — Mondays at 9 AM, compile what shipped, what's in-flight, and blockers\n• **Post-mortem nudge** — If an incident is >3 days old without a write-up, remind you and draft a skeleton\n\nWant any of these? I can also create a custom schedule if you have something else in mind.",
  },
  {
    role: "user",
    content:
      "Yes to morning PR triage and the weekly status digest. Skip the post-mortem nudge — I'll handle those manually. Can you also do a Friday EOD summary of what the team merged that week?",
  },
  {
    role: "agent",
    content:
      "Done — three schedules added. Now let me suggest some skills based on your workflow:\n\n• **PR Review (your style)** — Reviews PRs with your correctness → perf → style priority, top-level summary + inline comments\n• **Design Doc Drafter** — Generates docs in your format from a problem statement brain-dump\n• **Deploy Pipeline Monitor** — Watches your CI/CD and alerts on failures or slow stages\n• **Status Update Writer** — Compiles recent activity into your team's update format\n\nI can also create a custom skill together if something's missing, or pick from existing templates. What sounds right?",
  },
  {
    role: "user",
    content:
      "I want PR Review, Design Doc Drafter, and Status Update Writer. For the deploy monitor — can we build that one together? I want it to watch our ArgoCD deployments specifically and only alert if a rollout is stuck for >5 minutes.",
  },
  {
    role: "agent",
    content:
      "I've added the three skills. For the deploy monitor, let's build it:\n\nI'll create a skill called **ArgoCD Rollout Watcher** that polls your ArgoCD instance, checks rollout status, and only surfaces alerts when a deployment has been in a degraded or stuck state for more than 5 minutes. It'll include the app name, namespace, and what's blocking it.\n\nDoes that match what you need? Anything else to add before we finalize?",
  },
  {
    role: "user",
    content:
      "That's perfect. Let's also make it available in our #platform-eng Slack channel so the team can ask it questions too. I think we're good to go.",
  },
  {
    role: "agent",
    content:
      "Everything's configured. Take a look at the panel on the right — you can see all the context, skills, schedules, and the Slack channel I've set up. If it all looks good, hit Deploy and your agent will be live in a few minutes.",
  },
];

interface MockSkill {
  id: string;
  name: string;
  description: string;
  source: "custom" | "template" | "co-created";
  enabled: boolean;
}

interface MockSchedule {
  id: string;
  name: string;
  cadence: string;
  task: string;
  timezone: string;
  enabled: boolean;
}

interface MockContextGroup {
  id: string;
  title: string;
  entries: { label: string; value: string }[];
}

interface MockChannel {
  id: string;
  type: "slack" | "chat";
  name: string;
  description: string;
}

const MOCK_SKILLS: MockSkill[] = [
  {
    id: "skill-pr",
    name: "PR Review (Jamie's style)",
    description:
      "Reviews PRs with correctness → performance → style priority. Produces a top-level summary plus inline comments on each file.",
    source: "custom",
    enabled: true,
  },
  {
    id: "skill-docs",
    name: "Design Doc Drafter",
    description:
      "Generates design docs from a problem statement brain-dump. Follows your format: context, problem, solution, alternatives, migration plan, rollback.",
    source: "template",
    enabled: true,
  },
  {
    id: "skill-status",
    name: "Status Update Writer",
    description:
      "Compiles recent activity into shipped / in-flight / blockers format for weekly team updates.",
    source: "template",
    enabled: true,
  },
  {
    id: "skill-argo",
    name: "ArgoCD Rollout Watcher",
    description:
      "Monitors ArgoCD deployments and alerts when a rollout is stuck for >5 minutes. Reports app name, namespace, and blocking condition.",
    source: "co-created",
    enabled: true,
  },
];

const MOCK_SCHEDULES: MockSchedule[] = [
  {
    id: "sched-pr",
    name: "Morning PR triage",
    cadence: "Weekdays at 8:30 AM",
    task: "Review open PRs and leave a summary of what needs attention",
    timezone: "America/Los_Angeles",
    enabled: true,
  },
  {
    id: "sched-status",
    name: "Weekly status digest",
    cadence: "Mondays at 9:00 AM",
    task: "Compile what shipped, what's in-flight, and blockers into team update",
    timezone: "America/Los_Angeles",
    enabled: true,
  },
  {
    id: "sched-friday",
    name: "Friday team merge summary",
    cadence: "Fridays at 5:00 PM",
    task: "Summarize everything the team merged this week with key highlights",
    timezone: "America/Los_Angeles",
    enabled: true,
  },
];

const MOCK_CONTEXT: MockContextGroup[] = [
  {
    id: "ctx-identity",
    title: "About you",
    entries: [
      { label: "Name", value: "Jamie" },
      { label: "Role", value: "Senior Platform Engineer" },
      {
        label: "Responsibility",
        value: "Infrastructure team lead (4 engineers)",
      },
    ],
  },
  {
    id: "ctx-team",
    title: "Team",
    entries: [
      { label: "Sarah", value: "SRE focus" },
      { label: "Marcus", value: "Networking / service mesh" },
      { label: "Dev", value: "Observability" },
    ],
  },
  {
    id: "ctx-work",
    title: "Current work",
    entries: [
      { label: "Migration", value: "Linkerd → Istio service mesh" },
      { label: "Reviews", value: "6 open PRs" },
      { label: "Overdue", value: "Post-mortem from last week's outage" },
    ],
  },
  {
    id: "ctx-style",
    title: "Working patterns",
    entries: [
      {
        label: "PR reviews",
        value: "Correctness → perf → style, top-level summary + inline",
      },
      {
        label: "Design docs",
        value: "Context, problem, solution, alternatives, migration, rollback",
      },
      {
        label: "Post-mortems",
        value: "Blameless: timeline, contributing factors, action items",
      },
    ],
  },
];

const MOCK_CHANNELS: MockChannel[] = [
  {
    id: "channel-slack",
    type: "slack",
    name: "#platform-eng",
    description: "Team can ask the agent questions directly in this channel",
  },
];

function ConversationalBuilder({
  draft,
  onClose,
}: {
  draft: AgentDraft;
  onClose: () => void;
}) {
  const [messages] = useState<BuilderMessage[]>(PREFILLED_CONVERSATION);
  const [input, setInput] = useState("");
  const [deployed, setDeployed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const handleDeploy = () => {
    setDeployed(true);
    setTimeout(onClose, 2000);
  };

  if (deployed) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-300">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <Checkmark size={32} className="text-success" />
          </span>
          <h3 className="text-xl font-bold text-foreground">
            {draft.name} deployed
          </h3>
          <p className="text-sm text-muted-foreground">
            Your agent is starting up now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-[680px] mx-auto space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border px-6 py-4">
          <div className="max-w-[680px] mx-auto flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add more context, adjust skills, or say 'deploy'..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary min-h-[44px] max-h-[120px]"
            />
            <Button
              size="icon"
              disabled={!input.trim()}
              className="shrink-0 h-[44px] w-[44px]"
            >
              <SendAltFilled size={16} />
            </Button>
          </div>
        </div>
      </div>

      <aside className="w-[340px] border-l border-border bg-muted/30 flex flex-col">
        <div className="px-5 py-4 border-b border-border">
          <h4 className="text-sm font-semibold text-foreground">
            {draft.name || "New agent"}
          </h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            {draft.focus === "coding" ? "Coding agent" : "Research agent"}
            {draft.image && draft.focus === "research"
              ? ` · ${HARNESS_IMAGES.find((h) => h.id === draft.image)?.name}`
              : ""}
            {" · "}
            {draft.hibernation === "never" ? "Always-on" : "Hibernates"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            <ContextPanel groups={MOCK_CONTEXT} />
            <SkillsPanel skills={MOCK_SKILLS} />
            <SchedulesPanel schedules={MOCK_SCHEDULES} />
            <ChannelsPanel channels={MOCK_CHANNELS} />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border">
          <Button className="w-full" onClick={handleDeploy}>
            <Checkmark size={16} /> Deploy agent
          </Button>
        </div>
      </aside>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </p>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  );
}

function ContextPanel({ groups }: { groups: MockContextGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div>
      <SectionHeader title="Context" count={groups.length} />
      <div className="space-y-2">
        {groups.map((group) => (
          <div
            key={group.id}
            className="rounded-lg border border-border bg-background p-3 animate-in fade-in slide-in-from-left-2 duration-200"
          >
            <p className="text-sm font-medium text-foreground mb-2">
              {group.title}
            </p>
            <div className="space-y-1">
              {group.entries.map((entry) => (
                <div
                  key={entry.label}
                  className="flex items-baseline gap-2 text-sm"
                >
                  <span className="text-muted-foreground shrink-0">
                    {entry.label}
                  </span>
                  <span className="text-foreground">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsPanel({ skills }: { skills: MockSkill[] }) {
  if (skills.length === 0) return null;
  return (
    <div>
      <SectionHeader title="Skills" count={skills.length} />
      <div className="space-y-2">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-lg border border-border bg-background p-3 animate-in fade-in slide-in-from-left-2 duration-200"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-medium text-foreground">
                {skill.name}
              </p>
              <span
                className={cn(
                  "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
                  skill.source === "custom" && "bg-primary/10 text-primary",
                  skill.source === "template" &&
                    "bg-muted text-muted-foreground",
                  skill.source === "co-created" && "bg-warning/10 text-warning",
                )}
              >
                {skill.source === "co-created" ? "co-created" : skill.source}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {skill.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SchedulesPanel({ schedules }: { schedules: MockSchedule[] }) {
  if (schedules.length === 0) return null;
  return (
    <div>
      <SectionHeader title="Schedules" count={schedules.length} />
      <div className="space-y-2">
        {schedules.map((schedule) => (
          <div
            key={schedule.id}
            className="rounded-lg border border-border bg-background p-3 animate-in fade-in slide-in-from-left-2 duration-200"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium text-foreground">
                {schedule.name}
              </p>
              <span className="flex h-5 w-9 shrink-0 items-center rounded-full bg-primary px-0.5">
                <span className="h-4 w-4 translate-x-4 rounded-full bg-white" />
              </span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Time size={14} className="shrink-0" />
                <span>{schedule.cadence}</span>
              </div>
              <p className="text-muted-foreground pl-[22px]">{schedule.task}</p>
              <p className="text-muted-foreground/70 pl-[22px] text-[13px]">
                {schedule.timezone}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelsPanel({ channels }: { channels: MockChannel[] }) {
  if (channels.length === 0) return null;
  return (
    <div>
      <SectionHeader title="Channels" count={channels.length} />
      <div className="space-y-2">
        {channels.map((channel) => (
          <div
            key={channel.id}
            className="rounded-lg border border-border bg-background p-3 animate-in fade-in slide-in-from-left-2 duration-200"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
                  channel.type === "slack"
                    ? "bg-[#4A154B]/10 text-[#4A154B] dark:bg-[#E01E5A]/10 dark:text-[#E01E5A]"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {channel.type === "slack" ? "Slack" : "Chat"}
              </span>
              <p className="text-sm font-medium text-foreground">
                {channel.name}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {channel.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
