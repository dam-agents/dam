import { FaqAccordion } from "./faq-accordion.js";
import { SlackTeamIllustration } from "./slack-team-illustration.js";

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

/* ═══════ Band 1: What can my agent do? ══════════════════════════════ */

export function BandCapabilities() {
  return (
    <section className="flex min-h-[100dvh] items-center py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <SectionHeading>What can my agent do?</SectionHeading>
        <SectionTitle>Everything it needs to work like a teammate</SectionTitle>
        <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-muted-foreground">
          Every agent is built from the same building blocks.
        </p>

        <div className="mt-16 grid gap-x-14 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          <InfoBlock scene={<SchedulesScene />} title="Schedules">
            Runs a job on its own, every day or every week.
          </InfoBlock>
          <InfoBlock scene={<FilesScene />} title="Files & memory">
            Its files survive restarts and carry across every chat.
          </InfoBlock>
          <InfoBlock scene={<SkillsScene />} title="Skills">
            Instructions that teach your agent a new job. Share them across
            agents.
          </InfoBlock>
          <InfoBlock scene={<ConnectionsScene />} title="Connections">
            GitHub and other tools, without the agent ever seeing your tokens.
          </InfoBlock>
          <InfoBlock scene={<KnowledgeScene />} title="Knowledge">
            Point it at your sources. It keeps what it learns and answers from
            it.
          </InfoBlock>
          <InfoBlock scene={<ArtifactsScene />} title="Artifacts">
            Reports and dashboards you can share with a link.
          </InfoBlock>
        </div>
      </div>
    </section>
  );
}

/* ── Capability scenes (matching real DAM UI components) ─────────── */

function MiniSwitch({ on }: { on: boolean }) {
  return (
    <div
      className="relative h-5 w-9 shrink-0 rounded-full"
      style={{ backgroundColor: on ? "#121619" : "#dde1e6" }}
    >
      <div
        className="absolute top-0.5 size-4 rounded-full bg-white shadow-sm"
        style={{ left: on ? 18 : 2 }}
      />
    </div>
  );
}

function SchedulesScene() {
  return (
    <SceneCanvas w={260} h={170}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[196px]`}>
        <ScheduleRow label="Daily review" cadence="Every day · 9:00 AM" on />
        <ScheduleRow label="Nightly audit" cadence="Every day · 2:00 AM" on />
        <ScheduleRow
          label="Weekly sync"
          cadence="Every Mon · 8:00 AM"
          on={false}
        />
      </div>

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
  cadence,
  on,
}: {
  label: string;
  cadence: string;
  on: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-input px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold leading-tight text-foreground">
          {label}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
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
          <span className="truncate text-[14px] leading-tight">{cadence}</span>
        </div>
      </div>
      <MiniSwitch on={on} />
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
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[196px]`}>
        <div className="border-b border-input px-3 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Skills
          </span>
        </div>
        <SkillRow name="Code review" on />
        <SkillRow name="Plan feature" on />
        <SkillRow name="Write tests" on={false} />
      </div>

      <SceneTile x={218} y={16} color={ACCENT.pink}>
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

function SkillRow({ name, on }: { name: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-input px-3 py-2 last:border-b-0">
      <span className="text-[14px] font-medium text-foreground">{name}</span>
      <MiniSwitch on={on} />
    </div>
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
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[196px] px-3 py-2.5`}>
        <p className="text-[14px] font-medium text-muted-foreground">
          Connected knowledge bases
        </p>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between rounded-md border border-input px-2.5 py-1.5">
            <span className="text-[14px] font-medium text-foreground">
              Product docs
            </span>
            <span className="text-[14px] text-muted-foreground">12 sources</span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-input px-2.5 py-1.5">
            <span className="text-[14px] font-medium text-foreground">
              API reference
            </span>
            <span className="text-[14px] text-muted-foreground">8 sources</span>
          </div>
        </div>
      </div>

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
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[196px]`}>
        <ArtifactRow kind="HTML" kindColor={ACCENT.blue} title="Sprint report" meta="3 views · 2h ago" />
        <ArtifactRow kind="MD" kindColor="#0199f0" title="Meeting notes" meta="1 view · 5h ago" />
        <ArtifactRow kind="CODE" kindColor={ACCENT.green} title="migration.sql" meta="12 views · 1d ago" />
      </div>

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

function ArtifactRow({
  kind,
  kindColor,
  title,
  meta,
}: {
  kind: string;
  kindColor: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0">
      <span
        className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-white"
        style={{ backgroundColor: kindColor }}
      >
        {kind}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-foreground">{title}</p>
        <p className="truncate text-[14px] leading-tight text-muted-foreground">{meta}</p>
      </div>
    </div>
  );
}

/* ═══════ Band 2: Where does my agent live? ══════════════════════════ */

export function BandChannels() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden">
      {/* Right half — gold background with team illustration */}
      <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center lg:flex" style={{ backgroundColor: "#DE9950" }}>
        <div className="w-[140%] max-w-[860px] -ml-[8%] pr-10">
          <SlackTeamIllustration />
        </div>
      </div>
      {/* Left half gets the muted background */}
      <div className="absolute inset-y-0 left-0 hidden w-1/2 bg-muted/50 lg:block" />

      <div className="relative flex min-h-[100dvh] items-center bg-muted/50 lg:bg-transparent">
        <div className="mx-auto w-full max-w-[540px] px-6 py-20 lg:mx-0 lg:w-1/2 lg:max-w-none lg:py-28 lg:pl-12 lg:pr-16 xl:pl-20">
          <SectionHeading>Where does my agent live?</SectionHeading>
          <SectionTitle>Everywhere your team already works</SectionTitle>

          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
            Talk to it in DAM, in Slack, or from your editor.
          </p>
          <div className="mt-10 grid gap-6">
            <Channel
              logo={<DamUiLogo />}
              title="Web app"
              body="Chat with your agents and set them up."
            />
            <Channel
              logo={<SlackLogo />}
              title="Slack"
              body="DM your agent, or add it to a channel your team shares. In a channel, tag @dam to reach it."
            />
            <Channel
              logo={<IdeLogo />}
              title="Your IDE"
              body="Open the agent's files in VS Code or Zed."
            />
          </div>
          <p className="mt-6 text-[14px] leading-relaxed text-muted-foreground">
            Also works in Telegram.
          </p>
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
    <div className="flex items-start gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background shadow-[0_2px_8px_rgba(56,56,56,0.06)]">
        {logo}
      </div>
      <div>
        <p className="text-[15px] font-semibold leading-snug text-foreground">
          {title}
        </p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
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
            <SectionTitle>Open to IBM teams</SectionTitle>
            <p className="mt-4 max-w-[420px] text-[16px] leading-relaxed text-muted-foreground">
              Sign in if you have access. If not, join the waitlist and the
              DAM team will reach out.
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
                  Join the waitlist
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
