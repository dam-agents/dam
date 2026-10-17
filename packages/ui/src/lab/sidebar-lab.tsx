import "../App.css";

import {
  Add,
  ChevronDown,
  ChevronRight,
  Filter,
  Maximize,
  Minimize,
  OverflowMenuHorizontal,
  Search,
  Settings,
  Book,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";

import { BrandLogo } from "@/components/brand-logo";
import { HarnessIcons } from "@/components/harness-icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../modules/agents/components/avatar/agent-avatar.js";

type Attn = "approval" | "question" | "error" | "done";
interface Session {
  id: string;
  title: string;
  harness: string;
  ago: string;
  agent: string;
  attn?: Attn;
  working?: boolean;
}
interface Agent {
  name: string;
  state: "running" | "idle" | "asleep" | "error";
  mem: number;
  disk: number;
  sessions: Session[];
}

const S = (
  agent: string,
  id: string,
  title: string,
  harness: string,
  ago: string,
  extra: Partial<Session> = {},
): Session => ({ id, title, harness, ago, agent, ...extra });

const AGENTS: Agent[] = [
  {
    name: "release-bot",
    state: "running",
    mem: 0.62,
    disk: 0.31,
    sessions: [
      S(
        "release-bot",
        "r1",
        "Cut v2.14 and draft the changelog",
        "claude-code",
        "now",
        { attn: "approval", working: true },
      ),
      S(
        "release-bot",
        "r2",
        "Bump base images for CVE-2026-4411",
        "codex",
        "12m",
      ),
      S("release-bot", "r3", "Weekly dependency sweep", "claude-code", "3h"),
    ],
  },
  {
    name: "agent-2",
    state: "running",
    mem: 0.28,
    disk: 0.12,
    sessions: [
      S(
        "agent-2",
        "a1",
        "Why does the e2e suite flake on vm lanes?",
        "claude-code",
        "2m",
        { working: true },
      ),
      S("agent-2", "a2", "Say hi in one word.", "pi", "15h"),
    ],
  },
  {
    name: "research-notes",
    state: "idle",
    mem: 0.09,
    disk: 0.71,
    sessions: [
      S(
        "research-notes",
        "n1",
        "Summarise the microVM survey into a one-pager",
        "claude-code",
        "40m",
        { attn: "question" },
      ),
      S(
        "research-notes",
        "n2",
        "Compare CH vs Firecracker boot times",
        "bob",
        "1d",
      ),
      S("research-notes", "n3", "(no title · e4374202)", "codex", "2d"),
      S(
        "research-notes",
        "n4",
        "Reading list for libkrun",
        "claude-code",
        "4d",
      ),
    ],
  },
  {
    name: "subvol-2",
    state: "error",
    mem: 0,
    disk: 0.92,
    sessions: [
      S(
        "subvol-2",
        "s1",
        "Migrate the storage disk layout",
        "claude-code",
        "1h",
        { attn: "error" },
      ),
      S("subvol-2", "s2", "hello", "bob", "16h"),
    ],
  },
  {
    name: "qa-chat-1",
    state: "asleep",
    mem: 0,
    disk: 0.18,
    sessions: [
      S(
        "qa-chat-1",
        "q1",
        "Line one Line two Line four with a very long title that wraps",
        "claude-code",
        "5h",
        { attn: "done" },
      ),
      S(
        "qa-chat-1",
        "q2",
        "qa-chat-renamed session with a long title",
        "claude-code",
        "14h",
      ),
    ],
  },
  { name: "init-1", state: "asleep", mem: 0, disk: 0.04, sessions: [] },
  { name: "openrc-1", state: "idle", mem: 0.05, disk: 0.06, sessions: [] },
];

const ALL = AGENTS.flatMap((a) => a.sessions);
const ATTN = ALL.filter((s) => s.attn);

const ATTN_META: Record<Attn, { label: string; dot: string; chip: string }> = {
  approval: {
    label: "Needs approval",
    dot: "bg-warning",
    chip: "bg-warning/15 text-warning",
  },
  question: {
    label: "Asked you",
    dot: "bg-info",
    chip: "bg-info/15 text-info",
  },
  error: {
    label: "Failed",
    dot: "bg-danger",
    chip: "bg-danger/15 text-danger",
  },
  done: {
    label: "Finished",
    dot: "bg-success",
    chip: "bg-success/15 text-success",
  },
};
const STATE_DOT = {
  running: "bg-success",
  idle: "bg-muted-foreground/50",
  asleep: "hidden",
  error: "bg-danger",
};

const Avatar = ({ a, size = 22 }: { a: Agent; size?: number }) => (
  <span className="relative inline-flex shrink-0">
    <AgentAvatar
      name={a.name}
      size={size}
      mood={a.state === "asleep" ? "asleep" : "awake"}
    />
    <span
      className={cn("absolute rounded-full", STATE_DOT[a.state])}
      style={{
        width: 8,
        height: 8,
        right: -1,
        bottom: -1,
        boxShadow: "0 0 0 2px var(--color-card)",
      }}
    />
  </span>
);

const Harness = ({ h }: { h: string }) => (
  <HarnessIcons harnesses={[h]} size="xs" className="shrink-0 opacity-70" />
);

function Shell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative flex h-full flex-col bg-card px-2">
      <div className="flex items-center justify-between pt-3 pb-2 pl-1">
        <BrandLogo />
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <IconBtn label="Search">
            <Search size={16} />
          </IconBtn>
          <IconBtn label="New agent">
            <Add size={16} />
          </IconBtn>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <Usage />
      <div className="flex items-center gap-1 border-t border-border py-2 text-sm text-foreground/80">
        <span className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
          <Settings size={16} /> Settings
        </span>
        <IconBtn label="Docs">
          <Book size={16} />
        </IconBtn>
      </div>
      <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-primary px-1.5 text-2xs font-semibold text-primary-foreground">
        {label}
      </span>
    </div>
  );
}

function FullscreenTab({ expanded = false }: { expanded?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Expand to Home"
      className="absolute top-1/2 left-full z-raised flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg border-y border-r border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
    >
      {expanded ? <Minimize size={12} /> : <Maximize size={12} />}
    </button>
  );
}

const IconBtn = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <span
    aria-label={label}
    className="flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
  >
    {children}
  </span>
);

function Usage() {
  const Bar = ({
    label,
    used,
    total,
    v,
  }: {
    label: string;
    used: string;
    total: string;
    v: number;
  }) => (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-2xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {used} / {total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${v * 100}%`,
            background:
              v > 0.85
                ? "var(--color-warning)"
                : "var(--color-muted-foreground)",
          }}
        />
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-3">
      <Bar label="Memory" used="3.4 GiB" total="12 GiB" v={0.28} />
      <Bar label="Storage" used="452 GiB" total="926 GiB" v={0.49} />
    </div>
  );
}

const SectionHead = ({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) => (
  <div className="sticky top-0 z-raised flex items-center justify-between bg-card py-1.5 pr-1 pl-2">
    <span className="text-2xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </span>
    <span className="flex items-center gap-0.5 text-muted-foreground">
      {right}
    </span>
  </div>
);

const AttnDot = ({ attn }: { attn: Attn }) => (
  <span className={cn("size-1.5 shrink-0 rounded-full", ATTN_META[attn].dot)} />
);

function SessionLine({
  s,
  showAgent = false,
  active = false,
}: {
  s: Session;
  showAgent?: boolean;
  active?: boolean;
}) {
  const agent = AGENTS.find((a) => a.name === s.agent)!;
  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg px-2 py-1.5",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      {showAgent ? (
        <Avatar a={agent} size={18} />
      ) : (
        <span className="mt-1.5 flex w-[18px] justify-center">
          {s.attn ? <AttnDot attn={s.attn} /> : s.working ? <Spinner /> : null}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13px] leading-5",
            s.attn ? "font-medium text-foreground" : "text-foreground/80",
          )}
        >
          {s.title}
        </div>
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          {showAgent && <span className="truncate">{s.agent}</span>}
          {showAgent && <span>·</span>}
          <span>{s.ago}</span>
          {s.attn && (
            <span
              className={cn(
                "shrink-0 whitespace-nowrap rounded px-1 text-[10px] font-medium",
                ATTN_META[s.attn].chip,
              )}
            >
              {ATTN_META[s.attn].label}
            </span>
          )}
        </div>
      </div>
      <Harness h={s.harness} />
    </div>
  );
}

const Spinner = () => (
  <span className="size-2 animate-pulse rounded-full bg-primary" />
);

function VariantA() {
  const open = new Set(["agent-2"]);
  return (
    <Shell label="A · Accordion + leak">
      <SectionHead
        right={
          <IconBtn label="Filter">
            <Filter size={14} />
          </IconBtn>
        }
      >
        Agents
      </SectionHead>
      <ul className="flex flex-col gap-0.5">
        {AGENTS.map((a) => {
          const isOpen = open.has(a.name);
          const shown = isOpen ? a.sessions : a.sessions.filter((s) => s.attn);
          return (
            <li key={a.name}>
              <div
                className={cn(
                  "group flex h-9 items-center gap-2 rounded-lg px-1.5",
                  a.name === "agent-2" ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="flex size-4 items-center justify-center text-muted-foreground">
                  {a.sessions.length > 0 &&
                    (isOpen ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    ))}
                </span>
                <Avatar a={a} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {a.name}
                </span>
                {!isOpen && a.sessions.length > 0 && (
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {a.sessions.length}
                  </span>
                )}
              </div>
              {shown.length > 0 && (
                <div className="ml-[18px] border-l border-border pl-1">
                  {shown.map((s) => (
                    <SessionLine key={s.id} s={s} active={s.id === "a1"} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

function VariantB() {
  return (
    <Shell label="B · Cards">
      <SectionHead
        right={
          <IconBtn label="Filter">
            <Filter size={14} />
          </IconBtn>
        }
      >
        Agents
      </SectionHead>
      <div className="flex flex-col gap-2 pb-2">
        {AGENTS.map((a) => {
          const open = a.name === "release-bot";
          const attn = a.sessions.filter((s) => s.attn);
          return (
            <div
              key={a.name}
              className={cn(
                "rounded-xl border bg-background/40 transition-colors",
                open
                  ? "border-border-ui"
                  : "border-border hover:border-border-ui",
              )}
            >
              <div className="flex items-center gap-2.5 p-2.5">
                <Avatar a={a} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{a.name}</div>
                  <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <span className="capitalize">{a.state}</span>
                    {a.sessions.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{a.sessions.length} sessions</span>
                      </>
                    )}
                    {a.sessions[0] && (
                      <>
                        <span>·</span>
                        <span>{a.sessions[0].ago}</span>
                      </>
                    )}
                  </div>
                </div>
                {attn.length > 0 && !open && (
                  <span className="flex items-center gap-1">
                    {attn.map((s) => (
                      <AttnDot key={s.id} attn={s.attn!} />
                    ))}
                  </span>
                )}
                <OverflowMenuHorizontal
                  size={16}
                  className="text-muted-foreground"
                />
              </div>
              {!open &&
                attn.map((s) => (
                  <div
                    key={s.id}
                    className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs"
                  >
                    <AttnDot attn={s.attn!} />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span
                      className={cn(
                        "rounded px-1 text-[10px]",
                        ATTN_META[s.attn!].chip,
                      )}
                    >
                      {ATTN_META[s.attn!].label}
                    </span>
                  </div>
                ))}
              {open && (
                <div className="border-t border-border p-1">
                  {a.sessions.map((s) => (
                    <SessionLine key={s.id} s={s} />
                  ))}
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Add size={14} /> New session
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function VariantC() {
  return (
    <Shell label="C · Activity-first">
      <SectionHead>Needs you · {ATTN.length}</SectionHead>
      <div className="flex flex-col gap-1 pb-3">
        {ATTN.map((s) => {
          const a = AGENTS.find((x) => x.name === s.agent)!;
          return (
            <div
              key={s.id}
              className="flex gap-2.5 rounded-lg border border-border bg-background/40 p-2"
            >
              <Avatar a={a} size={22} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <span className="truncate">{a.name}</span>
                  <span>·</span>
                  <span>{s.ago}</span>
                </div>
                <div className="line-clamp-2 text-[13px] leading-5">
                  {s.title}
                </div>
                <span
                  className={cn(
                    "mt-1 inline-block rounded px-1.5 text-[10px] font-medium",
                    ATTN_META[s.attn!].chip,
                  )}
                >
                  {ATTN_META[s.attn!].label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <SectionHead
        right={
          <IconBtn label="Filter">
            <Filter size={14} />
          </IconBtn>
        }
      >
        Recent
      </SectionHead>
      <div className="flex flex-col pb-3">
        {ALL.filter((s) => !s.attn).map((s) => (
          <SessionLine key={s.id} s={s} showAgent active={s.id === "a1"} />
        ))}
      </div>
      <SectionHead>Agents</SectionHead>
      <div className="flex flex-wrap gap-1.5 px-2 pb-3">
        {AGENTS.map((a) => (
          <span
            key={a.name}
            className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-xs hover:bg-muted"
          >
            <Avatar a={a} size={20} />
            {a.name}
          </span>
        ))}
      </div>
    </Shell>
  );
}

function VariantD() {
  const [tab, setTab] = useState<"inbox" | "agents" | "all">("agents");
  return (
    <Shell label="D · Tabs">
      <div className="sticky top-0 z-raised mb-2 flex gap-0.5 rounded-lg bg-muted/60 p-0.5 text-xs">
        {(["inbox", "agents", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 capitalize",
              tab === t
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {t}
            {t === "inbox" && (
              <span className="rounded-full bg-warning/20 px-1.5 text-[10px] text-warning">
                {ATTN.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === "agents" && (
        <ul className="flex flex-col">
          {AGENTS.map((a) => {
            const attn = a.sessions.filter((s) => s.attn);
            const open = a.name === "research-notes";
            return (
              <li
                key={a.name}
                className={cn("rounded-lg", open && "bg-muted/40 pb-1")}
              >
                <div className="flex h-10 items-center gap-2.5 rounded-lg px-2 hover:bg-muted/60">
                  <Avatar a={a} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium leading-4">
                      {a.name}
                    </div>
                    <div className="truncate text-2xs text-muted-foreground">
                      {a.sessions[0]?.title ?? "No sessions yet"}
                    </div>
                  </div>
                  {attn.length > 0 && (
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                        ATTN_META[attn[0].attn!].chip,
                      )}
                    >
                      {attn.length}
                    </span>
                  )}
                </div>
                {open &&
                  a.sessions.map((s) => (
                    <div key={s.id} className="pl-6">
                      <SessionLine s={s} />
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {tab === "inbox" &&
        ATTN.map((s) => <SessionLine key={s.id} s={s} showAgent />)}
      {tab === "all" &&
        ALL.map((s) => <SessionLine key={s.id} s={s} showAgent />)}
    </Shell>
  );
}

function VariantE() {
  const sel = AGENTS[0];
  return (
    <Shell label="E · Avatar rail + list">
      <div className="flex h-full gap-1">
        <div className="flex flex-col items-center gap-1.5 border-r border-border pr-1.5 pt-1">
          <span
            className="flex size-9 items-center justify-center rounded-xl bg-muted text-2xs font-semibold text-muted-foreground"
            title="All"
          >
            All
          </span>
          {AGENTS.map((a) => {
            const n = a.sessions.filter((s) => s.attn).length;
            return (
              <span
                key={a.name}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-xl",
                  a === sel
                    ? "bg-muted ring-1 ring-border-ui"
                    : "hover:bg-muted/60",
                )}
              >
                <Avatar a={a} size={26} />
                {n > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-warning text-[9px] font-bold text-background">
                    {n}
                  </span>
                )}
              </span>
            );
          })}
          <span className="flex size-9 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
            <Add size={14} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 px-2 pt-1 pb-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {sel.name}
            </span>
            <span className="text-2xs text-success">running</span>
          </div>
          <SectionHead>Needs you</SectionHead>
          {ATTN.map((s) => (
            <SessionLine key={s.id} s={s} showAgent />
          ))}
          <SectionHead
            right={
              <IconBtn label="New">
                <Add size={14} />
              </IconBtn>
            }
          >
            Sessions
          </SectionHead>
          {sel.sessions.map((s) => (
            <SessionLine key={s.id} s={s} />
          ))}
        </div>
      </div>
    </Shell>
  );
}

function VariantF() {
  const open = new Set(["research-notes"]);
  return (
    <Shell label="F · Two-line + leak">
      <SectionHead
        right={
          <IconBtn label="Filter">
            <Filter size={14} />
          </IconBtn>
        }
      >
        Agents
      </SectionHead>
      <ul className="flex flex-col gap-0.5">
        {AGENTS.map((a) => {
          const isOpen = open.has(a.name);
          const attn = a.sessions.filter((s) => s.attn);
          const shown = isOpen ? a.sessions : attn;
          return (
            <li
              key={a.name}
              className={cn("rounded-lg", isOpen && "bg-muted/40 pb-1")}
            >
              <div className="group flex h-11 items-center gap-2.5 rounded-lg px-2 hover:bg-muted/60">
                <Avatar a={a} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium leading-4">
                    {a.name}
                  </div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {a.sessions.length === 0
                      ? "No sessions yet"
                      : `${a.sessions.length} sessions · ${a.sessions[0].ago}`}
                  </div>
                </div>
                {a.sessions.length > 0 && (
                  <span className="flex size-5 items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100">
                    {isOpen ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                )}
              </div>
              {shown.length > 0 && (
                <div className="ml-[21px] border-l border-border pl-1.5">
                  {shown.map((s) => (
                    <SessionLine key={s.id} s={s} />
                  ))}
                  {!isOpen && a.sessions.length > attn.length && (
                    <div className="px-2 py-1 text-2xs text-muted-foreground hover:text-foreground">
                      +{a.sessions.length - attn.length} more
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

const VARIANTS: Record<string, () => ReactNode> = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
  D: VariantD,
  E: VariantE,
  F: VariantF,
};

function Lab() {
  const params = new URLSearchParams(location.search);
  const only = params.get("v");
  const w = Number(params.get("w") ?? 280);
  const keys = only ? only.split(",") : Object.keys(VARIANTS);
  return (
    <TooltipProvider>
      <div className="flex h-dvh gap-12 overflow-x-auto bg-background p-6 pr-12 text-foreground">
        {keys.map((k) => {
          const V = VARIANTS[k];
          return (
            <div
              key={k}
              className="relative h-full shrink-0 overflow-visible rounded-xl border border-border"
              style={{ width: w }}
            >
              <div className="h-full overflow-hidden rounded-xl">
                <V />
              </div>
              <FullscreenTab />
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Lab />);
