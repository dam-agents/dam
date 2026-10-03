// Illustrations following the flow-board style guide (design/session-3):
// crayon-displaced black strokes, flat blue (#0f62fe), depth from overlap,
// rx 4 on every rect, only dots are round, no drop shadows.
// Dark mode: each illustration sits on its own white ground so strokes remain
// visible against --background: #0c0a09.

const BLUE = "#0f62fe";
const BLACK = "#000000";
const WHITE = "#ffffff";

function IllustrationWrap({
  children,
  width,
  height,
  label,
}: {
  children: React.ReactNode;
  width: number;
  height: number;
  label: string;
}) {
  return (
    <div className="rounded-lg bg-white p-3 dark:bg-white" role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {children}
      </svg>
    </div>
  );
}

/** Band 1: a code review card with cursor and comment bubble */
export function IllustrationCodeReview() {
  return (
    <IllustrationWrap width={200} height={140} label="Code review task">
      {/* card outline — crayon displaced */}
      <rect
        x="20"
        y="10"
        width="160"
        height="100"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      {/* text lines inside card */}
      <rect x="34" y="28" width="80" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="34" y="40" width="60" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="34" y="52" width="90" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      {/* blue highlight line */}
      <rect x="34" y="64" width="70" height="6" rx="3" fill={BLUE} />
      {/* comment bubble overlapping card */}
      <rect x="120" y="70" width="56" height="36" rx="4" fill={BLACK} />
      <rect x="130" y="80" width="36" height="3" rx="1.5" fill={WHITE} />
      <rect x="130" y="88" width="24" height="3" rx="1.5" fill={WHITE} />
      {/* floating dots */}
      <circle cx="14" cy="50" r="3" fill={BLUE} />
      <circle cx="186" cy="24" r="2" fill={BLACK} />
    </IllustrationWrap>
  );
}

/** Band 1: a web app window with layout blocks */
export function IllustrationWebApp() {
  return (
    <IllustrationWrap width={200} height={140} label="Web app development task">
      {/* browser window outline */}
      <rect
        x="16"
        y="12"
        width="168"
        height="110"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      {/* title bar dots */}
      <circle cx="30" cy="24" r="3" fill={BLACK} />
      <circle cx="40" cy="24" r="3" fill={BLACK} />
      <circle cx="50" cy="24" r="3" fill={BLACK} />
      {/* sidebar */}
      <rect x="22" y="34" width="36" height="80" rx="4" fill={BLACK} />
      <rect x="28" y="42" width="24" height="3" rx="1.5" fill={WHITE} />
      <rect x="28" y="50" width="18" height="3" rx="1.5" fill={WHITE} />
      <rect x="28" y="58" width="20" height="3" rx="1.5" fill={BLUE} />
      {/* main content blocks */}
      <rect x="66" y="34" width="110" height="36" rx="4" fill={BLUE} />
      <rect x="66" y="78" width="52" height="36" rx="4" fill={BLACK} opacity={0.15} filter="url(#grain)" />
      <rect x="124" y="78" width="52" height="36" rx="4" fill={BLACK} opacity={0.15} filter="url(#grain)" />
      {/* floating dot */}
      <circle cx="190" cy="60" r="2.5" fill={BLUE} />
    </IllustrationWrap>
  );
}

/** Band 1: a monitoring dashboard with status indicators */
export function IllustrationMonitor() {
  return (
    <IllustrationWrap width={200} height={140} label="Link monitoring task">
      {/* dashboard outline */}
      <rect
        x="18"
        y="10"
        width="164"
        height="108"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      {/* status rows */}
      <rect x="30" y="28" width="100" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <circle cx="160" cy="30" r="5" fill="#24a148" />
      <rect x="30" y="44" width="80" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <circle cx="160" cy="46" r="5" fill="#24a148" />
      <rect x="30" y="60" width="90" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <circle cx="160" cy="62" r="5" fill="#dc2626" />
      <rect x="30" y="76" width="70" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <circle cx="160" cy="78" r="5" fill="#24a148" />
      {/* blue bar at bottom */}
      <rect x="30" y="94" width="140" height="10" rx="4" fill={BLUE} />
      {/* floating dots */}
      <circle cx="12" cy="70" r="2" fill={BLUE} />
      <circle cx="188" cy="100" r="3" fill={BLACK} />
    </IllustrationWrap>
  );
}

/** Band 2 beat 1: Slack message "ask" */
export function IllustrationAsk() {
  return (
    <IllustrationWrap width={240} height={160} label="Ask your agent in Slack">
      {/* Slack-like message area */}
      <rect
        x="20"
        y="12"
        width="200"
        height="136"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      {/* channel name */}
      <rect x="32" y="24" width="60" height="5" rx="2.5" fill={BLACK} filter="url(#crayon-sm)" />
      {/* divider */}
      <line x1="32" y1="38" x2="208" y2="38" stroke={BLACK} strokeWidth="1" opacity={0.2} />
      {/* user message */}
      <circle cx="44" cy="56" r="8" fill={BLACK} />
      <rect x="58" y="48" width="120" height="6" rx="3" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="58" y="60" width="80" height="5" rx="2.5" fill={BLACK} filter="url(#crayon-sm)" />
      {/* agent reply with blue accent */}
      <circle cx="44" cy="92" r="8" fill={BLUE} />
      <rect x="58" y="84" width="140" height="6" rx="3" fill={BLUE} />
      <rect x="58" y="96" width="100" height="5" rx="2.5" fill={BLACK} filter="url(#crayon-sm)" />
      {/* compose bar */}
      <rect x="32" y="118" width="176" height="20" rx="4" fill={BLACK} opacity={0.06} />
      <rect x="40" y="125" width="60" height="4" rx="2" fill={BLACK} opacity={0.2} />
      {/* floating dots */}
      <circle cx="14" cy="80" r="2.5" fill={BLUE} />
      <circle cx="226" cy="30" r="2" fill={BLACK} />
    </IllustrationWrap>
  );
}

/** Band 2 beat 2: Schedule card appears */
export function IllustrationSchedule() {
  return (
    <IllustrationWrap width={240} height={160} label="A schedule is created">
      {/* schedule card */}
      <rect x="30" y="16" width="180" height="128" rx="4" fill={BLACK} />
      {/* header area */}
      <rect x="42" y="28" width="80" height="6" rx="3" fill={WHITE} />
      <rect x="42" y="40" width="50" height="4" rx="2" fill={WHITE} opacity={0.5} />
      {/* time slots */}
      <rect x="42" y="58" width="156" height="20" rx="4" fill={BLUE} />
      <rect x="50" y="64" width="60" height="4" rx="2" fill={WHITE} />
      <rect x="50" y="71" width="40" height="3" rx="1.5" fill={WHITE} opacity={0.6} />
      <rect x="42" y="86" width="156" height="20" rx="4" fill={WHITE} opacity={0.1} />
      <rect x="50" y="92" width="60" height="4" rx="2" fill={WHITE} opacity={0.4} />
      <rect x="42" y="114" width="156" height="20" rx="4" fill={WHITE} opacity={0.1} />
      <rect x="50" y="120" width="60" height="4" rx="2" fill={WHITE} opacity={0.4} />
      {/* floating dots */}
      <circle cx="22" cy="40" r="3" fill={BLUE} />
      <circle cx="218" cy="130" r="2" fill={BLUE} />
    </IllustrationWrap>
  );
}

/** Band 2 beat 3: Result comes back */
export function IllustrationResult() {
  return (
    <IllustrationWrap width={240} height={160} label="The result arrives in Slack">
      {/* notification card outline */}
      <rect
        x="24"
        y="14"
        width="192"
        height="132"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      {/* agent avatar */}
      <circle cx="48" cy="40" r="10" fill={BLUE} />
      {/* agent name + timestamp */}
      <rect x="64" y="34" width="50" height="5" rx="2.5" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="120" y="35" width="30" height="3" rx="1.5" fill={BLACK} opacity={0.3} />
      {/* result summary block */}
      <rect x="40" y="58" width="168" height="40" rx="4" fill={BLUE} opacity={0.08} />
      <rect x="50" y="66" width="100" height="5" rx="2.5" fill={BLUE} />
      <rect x="50" y="78" width="140" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="50" y="88" width="80" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      {/* checkmark indicator */}
      <circle cx="48" cy="120" r="8" fill="#24a148" />
      <rect x="64" y="116" width="80" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="64" y="126" width="50" height="3" rx="1.5" fill={BLACK} opacity={0.4} />
      {/* floating dots */}
      <circle cx="18" cy="100" r="2" fill={BLUE} />
      <circle cx="222" cy="50" r="3" fill={BLACK} />
    </IllustrationWrap>
  );
}

/** Band 3: Three channel icons (Chat, Slack, Telegram) */
export function IllustrationChannels() {
  return (
    <IllustrationWrap width={320} height={100} label="Chat, Slack, and Telegram">
      {/* Chat bubble */}
      <rect
        x="16"
        y="16"
        width="80"
        height="68"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      <rect x="28" y="32" width="40" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="28" y="42" width="50" height="4" rx="2" fill={BLUE} />
      <rect x="28" y="52" width="30" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="28" y="66" width="56" height="10" rx="4" fill={BLACK} opacity={0.06} />

      {/* Slack */}
      <rect x="120" y="16" width="80" height="68" rx="4" fill={BLACK} />
      <rect x="136" y="30" width="48" height="5" rx="2.5" fill={WHITE} />
      <rect x="136" y="42" width="36" height="4" rx="2" fill={WHITE} opacity={0.5} />
      <rect x="136" y="54" width="48" height="4" rx="2" fill={BLUE} />
      <circle cx="132" cy="56" r="3" fill={BLUE} />

      {/* Telegram */}
      <rect
        x="224"
        y="16"
        width="80"
        height="68"
        rx="4"
        stroke={BLACK}
        strokeWidth="2"
        filter="url(#crayon)"
      />
      <circle cx="264" cy="38" r="10" fill={BLUE} />
      <rect x="240" y="56" width="48" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />
      <rect x="240" y="66" width="32" height="4" rx="2" fill={BLACK} filter="url(#crayon-sm)" />

      {/* floating dots */}
      <circle cx="110" cy="50" r="2" fill={BLUE} />
      <circle cx="214" cy="30" r="2.5" fill={BLACK} />
    </IllustrationWrap>
  );
}
