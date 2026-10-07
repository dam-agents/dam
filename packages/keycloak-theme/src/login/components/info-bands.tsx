import { FaqAccordion } from "./faq-accordion.js";

const LOGIN_DOCS_URL = "https://ibm.biz/dam-docs";

/* ── Shared typography ──────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[14px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h2>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[28px] font-semibold leading-snug tracking-[-0.5px] text-foreground md:text-[32px]">
      {children}
    </p>
  );
}

/* ── Avatar palette ─────────────────────────────────────────────────── */

const ACCENT = {
  cyan: "#04a3be",
  green: "#03b065",
  indigo: "#7584fe",
  pink: "#f04e82",
  orange: "#e38804",
  purple: "#af6af2",
  blue: "#0199f0",
  teal: "#03a99b",
} as const;

/* ── Scene illustration primitives ───────────────────────────────────
   Same visual language as the empty-state illustrations in the main UI:
   dashed circle canvas, floating white cards with shadows, icon tiles.  */

const SCENE_CARD =
  "absolute rounded-lg border border-input bg-background shadow-[0_4px_24px_rgba(56,56,56,0.08)]";

function SceneCanvas({
  w,
  h,
  children,
}: {
  w: number;
  h: number;
  children: React.ReactNode;
}) {
  const r = Math.min(w, h) * 0.43;
  return (
    <div
      className="relative w-full"
      style={{ maxWidth: w, height: h }}
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        fill="none"
      >
        <circle
          cx={w / 2}
          cy={h / 2}
          r={r}
          className="stroke-input"
          strokeDasharray="4 4"
        />
      </svg>
      {children}
    </div>
  );
}

function SceneTile({
  x,
  y,
  color,
  children,
}: {
  x: number;
  y: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute flex size-[30px] items-center justify-center rounded-[7px] border border-input bg-background"
      style={{ left: x, top: y, color }}
    >
      {children}
    </div>
  );
}

function InfoBlock({
  scene,
  title,
  children,
}: {
  scene: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {scene}
      <p className="mt-5 text-[16px] font-semibold leading-snug text-foreground">
        {title}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/* ═══════ Band 1: What is DAM? ═══════════════════════════════════════ */

export function BandWhatIsDam() {
  return (
    <section className="flex min-h-[100dvh] items-center py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <SectionHeading>What is DAM?</SectionHeading>
        <SectionTitle>The platform for long-lived AI agents</SectionTitle>
        <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-muted-foreground">
          Each agent gets its own isolated pod, persistent workspace, injected
          credentials, and network boundary.
        </p>

        <div className="mt-16 grid gap-14 sm:grid-cols-3">
          <InfoBlock scene={<AlwaysOnScene />} title="Always-on operation">
            Agents persist after you close your laptop. Workspaces survive
            restarts.
          </InfoBlock>
          <InfoBlock scene={<SecureByDefaultScene />} title="Secure by default">
            Zero direct credential access. A paired gateway injects secrets
            and enforces network policy.
          </InfoBlock>
          <InfoBlock
            scene={<HarnessAgnosticScene />}
            title="Harness & model agnostic"
          >
            Claude Code, Codex, or any ACP runtime. Bring the harness your
            team prefers.
          </InfoBlock>
        </div>
      </div>
    </section>
  );
}

/* ── Pillar scenes ───────────────────────────────────────────────────── */

function AlwaysOnScene() {
  return (
    <SceneCanvas w={300} h={200}>
      {/* Card: agent run status */}
      <div
        className={`${SCENE_CARD} left-[16px] top-[14px] w-[188px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="text-[14px] font-semibold leading-tight text-foreground">
            Nightly audit
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[14px] leading-tight text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M8 5v3l2.5 2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          Ran 2:04 AM
        </p>
      </div>

      {/* Badge: completed */}
      <div
        className={`${SCENE_CARD} left-[56px] top-[106px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="#24A148" />
          <path
            d="M5 8l2 2 4-4"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[14px] font-medium text-foreground">
          Completed · 4 min
        </span>
      </div>

      {/* Tile: clock */}
      <SceneTile x={250} y={22} color={ACCENT.cyan}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 5v3l2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function SecureByDefaultScene() {
  return (
    <SceneCanvas w={300} h={200}>
      {/* Card: secrets list */}
      <div
        className={`${SCENE_CARD} left-[16px] top-[14px] w-[188px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="7"
              width="10"
              height="7"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M5.5 7V5a2.5 2.5 0 015 0v2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-[14px] font-semibold text-foreground">
            Secrets
          </span>
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[14px] text-muted-foreground">
              DB_PASS
            </span>
            <span className="text-[14px] text-muted-foreground/50">••••</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[14px] text-muted-foreground">
              API_KEY
            </span>
            <span className="text-[14px] text-muted-foreground/50">••••</span>
          </div>
        </div>
      </div>

      {/* Badge: isolated */}
      <div
        className={`${SCENE_CARD} left-[56px] top-[118px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 1.5l6 2.5v4c0 4-2.5 7-6 8.5-3.5-1.5-6-4.5-6-8.5V4l6-2.5z"
            fill={`${ACCENT.green}20`}
            stroke={ACCENT.green}
            strokeWidth="1.2"
          />
          <path
            d="M5.5 8l2 2 3-3"
            stroke={ACCENT.green}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[14px] font-medium text-foreground">
          Isolated
        </span>
      </div>

      {/* Tile: shield */}
      <SceneTile x={250} y={22} color={ACCENT.green}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 2l5.5 2v3.5c0 3.5-2.2 6.2-5.5 7.5-3.3-1.3-5.5-4-5.5-7.5V4L8 2z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ClaudeCodeLogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="5" fill="#d97757" />
      <g transform="translate(4,4) scale(0.667)">
        <path
          d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
          fill="#fff"
        />
      </g>
    </svg>
  );
}

function OpenAILogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="5" fill="#000" />
      <g transform="translate(4,4) scale(0.667)">
        <path
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
          fill="#fff"
        />
      </g>
    </svg>
  );
}

function GeminiLogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="5" fill="#1A73E8" />
      <g transform="translate(4,4) scale(0.667)">
        <path
          d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
          fill="#fff"
        />
      </g>
    </svg>
  );
}

function HarnessAgnosticScene() {
  return (
    <SceneCanvas w={300} h={200}>
      {/* Card: harness list */}
      <div
        className={`${SCENE_CARD} left-[16px] top-[10px] w-[188px] divide-y divide-input px-3`}
      >
        <div className="flex items-center gap-2.5 py-2">
          <ClaudeCodeLogo />
          <span className="text-[14px] font-medium leading-tight text-foreground">
            Claude Code
          </span>
        </div>
        <div className="flex items-center gap-2.5 py-2">
          <OpenAILogo />
          <span className="text-[14px] font-medium leading-tight text-foreground">
            Codex
          </span>
        </div>
        <div className="flex items-center gap-2.5 py-2">
          <GeminiLogo />
          <span className="text-[14px] font-medium leading-tight text-foreground">
            Gemini CLI
          </span>
        </div>
      </div>

      {/* Badge: ACP */}
      <div
        className={`${SCENE_CARD} left-[56px] top-[130px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 4h4M3 8h10M6 12h4"
            stroke={ACCENT.indigo}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-[14px] font-medium text-foreground">ACP</span>
      </div>

      {/* Tile: terminal */}
      <SceneTile x={250} y={18} color={ACCENT.indigo}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 12l-3 3M4 12l-3-3M6 3h7v12"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

/* ═══════ Band 2: What can my agent do? ══════════════════════════════ */

export function BandCapabilities() {
  return (
    <section className="flex min-h-[100dvh] items-center py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <SectionHeading>What can my agent do?</SectionHeading>
        <SectionTitle>Everything it needs to work like a teammate</SectionTitle>
        <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-muted-foreground">
          Every agent is assembled from reusable building blocks. Compose them
          however your team needs.
        </p>

        <div className="mt-16 grid gap-x-14 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          <InfoBlock scene={<SchedulesScene />} title="Schedules">
            Recurring tasks — daily reviews, nightly audits, no human in the
            loop.
          </InfoBlock>
          <InfoBlock scene={<FilesScene />} title="Files & memory">
            A persistent workspace that survives restarts. Files and context
            carry across sessions.
          </InfoBlock>
          <InfoBlock scene={<SkillsScene />} title="Skills">
            Packaged instructions that teach a capability. Install once, reuse
            everywhere.
          </InfoBlock>
          <InfoBlock scene={<ConnectionsScene />} title="Connections">
            GitHub, APIs, and credentials — without the agent ever seeing your
            tokens.
          </InfoBlock>
          <InfoBlock scene={<KnowledgeScene />} title="Knowledge bases">
            Feed sources, ask questions, get answers with citations.
          </InfoBlock>
          <InfoBlock scene={<ArtifactsScene />} title="Artifacts">
            Reports, dashboards, and data files that outlive any single run.
          </InfoBlock>
        </div>
      </div>
    </section>
  );
}

/* ── Capability scenes ───────────────────────────────────────────────── */

function SchedulesScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: schedule list */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] px-3 py-2.5`}
      >
        <ScheduleRow label="Daily review" time="9:00 AM" on />
        <ScheduleRow label="Nightly audit" time="2:00 AM" on />
        <ScheduleRow label="Weekly sync" time="Mon 8 AM" on={false} />
      </div>

      {/* Tile: clock */}
      <SceneTile x={218} y={16} color={ACCENT.cyan}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 5v3l2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ScheduleRow({
  label,
  time,
  on,
}: {
  label: string;
  time: string;
  on: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <p className="text-[14px] font-medium leading-tight text-foreground">
          {label}
        </p>
        <p className="text-[14px] leading-tight text-muted-foreground">
          {time}
        </p>
      </div>
      <div
        className="flex h-4 w-7 items-center rounded-full px-0.5"
        style={{ backgroundColor: on ? ACCENT.cyan : "#dde1e6" }}
      >
        <div
          className="size-3 rounded-full bg-white transition-transform"
          style={{ transform: on ? "translateX(12px)" : "translateX(0)" }}
        />
      </div>
    </div>
  );
}

function FilesScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: file tree */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
              stroke={ACCENT.indigo}
              strokeWidth="1.2"
            />
          </svg>
          <span className="text-[14px] font-medium text-foreground">
            workspace
          </span>
        </div>
        <div className="ml-4 mt-1.5 space-y-1 border-l border-input pl-3">
          <FileRow name="config.yaml" />
          <FileRow name="memory.md" />
          <FileRow name="output/" folder />
        </div>
      </div>

      {/* Badge: persistent */}
      <div
        className={`${SCENE_CARD} left-[44px] top-[118px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="#24A148" />
          <path
            d="M5 8l2 2 4-4"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[14px] font-medium text-foreground">
          Persistent
        </span>
      </div>

      {/* Tile: file */}
      <SceneTile x={218} y={16} color={ACCENT.indigo}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function FileRow({ name, folder }: { name: string; folder?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
      {folder ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )}
      <span>{name}</span>
    </div>
  );
}

function SkillsScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: skill detail */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex size-6 items-center justify-center rounded-md"
            style={{ backgroundColor: `${ACCENT.pink}15`, color: ACCENT.pink }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 1.5l1.8 3.6 4 .6-2.9 2.8.7 4L8 10.7l-3.6 1.8.7-4-2.9-2.8 4-.6L8 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-[14px] font-semibold text-foreground">
            Plan feature
          </span>
        </div>
        <p className="mt-1.5 text-[14px] leading-snug text-muted-foreground">
          Break a feature brief into tasks and draft a PRD.
        </p>
        <div className="mt-2 flex items-center gap-1">
          <span
            className="rounded-full px-2 py-0.5 text-[14px] font-medium"
            style={{
              backgroundColor: `${ACCENT.green}15`,
              color: ACCENT.green,
            }}
          >
            Installed
          </span>
        </div>
      </div>

      {/* Tile: star */}
      <SceneTile x={218} y={16} color={ACCENT.pink}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 1.5l1.8 3.6 4 .6-2.9 2.8.7 4L8 10.7l-3.6 1.8.7-4-2.9-2.8 4-.6L8 1.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ConnectionsScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: connection list */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] divide-y divide-input px-3`}
      >
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
                fill="currentColor"
                className="text-foreground"
              />
            </svg>
            <span className="text-[14px] font-medium text-foreground">
              GitHub
            </span>
          </div>
          <div className="size-2 rounded-full bg-emerald-500" />
        </div>
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 4a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4z"
                stroke="currentColor"
                strokeWidth="1.2"
                className="text-muted-foreground"
              />
              <path
                d="M5 7h6M5 10h3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-muted-foreground"
              />
            </svg>
            <span className="text-[14px] font-medium text-foreground">
              Jira
            </span>
          </div>
          <div className="size-2 rounded-full bg-input" />
        </div>
      </div>

      {/* Tile: link */}
      <SceneTile x={218} y={16} color={ACCENT.green}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6.5 9.5l3-3M5 11a2.83 2.83 0 01-2-4.83L5.17 4A2.83 2.83 0 0110 6M11 5a2.83 2.83 0 012 4.83L10.83 12A2.83 2.83 0 016 10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function KnowledgeScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: knowledge base */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
          <span className="text-[14px] font-semibold text-foreground">
            Product docs
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1 w-full rounded-full bg-input" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-4/5 rounded-full bg-input" />
          </div>
        </div>
        <p className="mt-2 text-[14px] text-muted-foreground">
          12 sources · 3.2k chunks
        </p>
      </div>

      {/* Badge: citation */}
      <div
        className={`${SCENE_CARD} left-[44px] top-[118px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <span
          className="flex size-4 items-center justify-center rounded text-[14px] font-semibold"
          style={{
            backgroundColor: `${ACCENT.orange}15`,
            color: ACCENT.orange,
          }}
        >
          1
        </span>
        <span className="text-[14px] font-medium text-foreground">
          api-guide.md
        </span>
      </div>

      {/* Tile: folder */}
      <SceneTile x={218} y={16} color={ACCENT.orange}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ArtifactsScene() {
  return (
    <SceneCanvas w={260} h={170}>
      {/* Card: artifact preview */}
      <div
        className={`${SCENE_CARD} left-[12px] top-[10px] w-[172px] px-3 py-2.5`}
      >
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="2"
              y="2"
              width="12"
              height="12"
              rx="2"
              stroke={ACCENT.purple}
              strokeWidth="1.2"
            />
            <path
              d="M5 6h6M5 9h4"
              stroke={ACCENT.purple}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-[14px] font-semibold text-foreground">
            Sprint report
          </span>
        </div>
        {/* Mini bar chart */}
        <div className="mt-2 flex items-end gap-1">
          {[0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: h * 24,
                backgroundColor: `${ACCENT.purple}${i === 3 ? "50" : "25"}`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Badge: shared */}
      <div
        className={`${SCENE_CARD} left-[44px] top-[118px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="4" cy="8" r="2" stroke={ACCENT.purple} strokeWidth="1.2" />
          <circle
            cx="12"
            cy="4"
            r="2"
            stroke={ACCENT.purple}
            strokeWidth="1.2"
          />
          <circle
            cx="12"
            cy="12"
            r="2"
            stroke={ACCENT.purple}
            strokeWidth="1.2"
          />
          <path
            d="M5.8 7l4.4-2M5.8 9l4.4 2"
            stroke={ACCENT.purple}
            strokeWidth="1.2"
          />
        </svg>
        <span className="text-[14px] font-medium text-foreground">Shared</span>
      </div>

      {/* Tile: document */}
      <SceneTile x={218} y={16} color={ACCENT.purple}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="2"
            width="10"
            height="12"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M6 6h4M6 9h3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

/* ═══════ Band 3: Where does my agent live? ══════════════════════════ */

export function BandChannels() {
  return (
    <section className="relative min-h-[100dvh]">
      {/* Visual placeholder — right half, full bleed */}
      <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-gray-200 lg:block dark:bg-gray-800" />
      {/* Left half gets the muted background */}
      <div className="absolute inset-y-0 left-0 hidden w-1/2 bg-muted/50 lg:block" />

      <div className="relative flex min-h-[100dvh] items-center bg-muted/50 lg:bg-transparent">
        <div className="mx-auto w-full max-w-[540px] px-6 py-20 lg:mx-0 lg:w-1/2 lg:max-w-none lg:py-28 lg:pl-12 lg:pr-16 xl:pl-20">
          <SectionHeading>Where does my agent live?</SectionHeading>
          <SectionTitle>Everywhere your team already works</SectionTitle>

          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
            Talk to your agent in the platform, or connect it to the tools
            your team uses every day.
          </p>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <Channel
              logo={<DamUiLogo />}
              title="DAM UI"
              body="Chat, configure, and manage agents in the DAM web UI."
            />
            <Channel
              logo={<SlackLogo />}
              title="Slack"
              body="Talk to your agent privately in your DMs, or bind it to a channel where your team can use it."
            />
            <Channel
              logo={<TelegramLogo />}
              title="Telegram"
              body="Add the bot to a DM or group. Agents respond and post on schedule."
            />
            <Channel
              logo={<IdeLogo />}
              title="Your IDE"
              body="VS Code, Zed, or IntelliJ pointed at the agent's live workspace."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Channel({
  logo,
  title,
  body,
}: {
  logo: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex size-12 items-center justify-center rounded-xl border border-input bg-background shadow-[0_2px_8px_rgba(56,56,56,0.06)]">
        {logo}
      </div>
      <p className="mt-3 text-[16px] font-semibold leading-snug text-foreground">
        {title}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function DamUiLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 125 125"
      fill="none"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M75.74 53.57C70.80 53.57 66.80 57.58 66.80 62.52C66.80 67.46 70.80 71.46 75.74 71.46C80.68 71.46 84.68 67.46 84.68 62.52C84.68 57.58 80.68 53.57 75.74 53.57Z"
        fill="#E89DA8"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M49.25 53.57C44.31 53.57 40.30 57.58 40.30 62.52C40.30 67.46 44.31 71.46 49.25 71.46C54.19 71.46 58.19 67.46 58.19 62.52C58.19 57.58 54.19 53.57 49.25 53.57Z"
        fill="#E89DA8"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z"
        fill="#3F6C45"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
        fill="#3F6C45"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z"
        fill="#3F6C45"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z"
        fill="#3F6C45"
      />
    </svg>
  );
}

function SlackLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 122.8 122.8"
      aria-hidden="true"
    >
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9z"
        fill="#E01E5A"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9z"
        fill="#36C5F0"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9z"
        fill="#2EB67D"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function TelegramLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="#26A5E4"
      aria-hidden="true"
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function IdeLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="4"
        width="24"
        height="18"
        rx="2.5"
        stroke={ACCENT.indigo}
        strokeWidth="1.5"
      />
      <path
        d="M7 13l3-3M7 13l3 3"
        stroke={ACCENT.indigo}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 16h5"
        stroke={ACCENT.indigo}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ═══════ Band 4: FAQ ════════════════════════════════════════════════ */

export function BandFaq() {
  return (
    <section className="flex min-h-[100dvh] items-center py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[720px] px-6">
        <SectionHeading>Common questions</SectionHeading>
        <div className="mt-8">
          <FaqAccordion />
        </div>
      </div>
    </section>
  );
}

/* ═══════ Band 5: Get started ════════════════════════════════════════ */

export function BandAccess({
  requestAccessUrl,
  formEl,
  characters,
}: {
  requestAccessUrl: string | undefined;
  formEl?: React.ReactNode;
  characters?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[100dvh] items-center bg-muted/50 py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex items-start gap-12">
          <div className="flex-1">
            <SectionHeading>Get started</SectionHeading>
            <SectionTitle>Available to IBM Research teams</SectionTitle>
            <p className="mt-4 max-w-[420px] text-[16px] leading-relaxed text-muted-foreground">
              Sign in if you have access. Otherwise, request it and your team
              admin will be notified.
            </p>

            {formEl && (
              <div className="mt-8 max-w-[var(--width-login-col)]">
                {formEl}
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-4">
              {requestAccessUrl && (
                <a
                  href={requestAccessUrl}
                  className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-6 text-[15px] font-medium text-foreground hover:bg-muted"
                >
                  Request access
                </a>
              )}
              <a
                href={LOGIN_DOCS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-11 items-center text-[15px] text-accent hover:underline"
              >
                Read the docs
              </a>
            </div>

            <p className="mt-6 text-[14px] leading-relaxed text-muted-foreground">
              Questions? Ask in{" "}
              <span className="font-medium text-foreground">
                #dam-community
              </span>{" "}
              on Slack.
            </p>
          </div>

          {characters}
        </div>
      </div>
    </section>
  );
}
