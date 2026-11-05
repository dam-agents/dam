import { SectionLabel, SectionTitle, SHAPE_COLOR } from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The "For DevOps" section: agents review pull
 * requests and diagnose clusters while the credentials stay out of their
 * reach, beside a terminal card of an agent diagnosing a crashing pod. The card
 * is a dark terminal in both themes. */
export function DevOpsSection() {
  return (
    <section className="flex min-h-dvh snap-start items-center py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-20">
          <div className="lg:w-[420px] lg:shrink-0">
            <SectionLabel color={SHAPE_COLOR.gold}>For DevOps</SectionLabel>
            <SectionTitle>Run agents on your repos and clusters.</SectionTitle>
            <p className="text-muted-foreground mt-5 text-[16px] leading-relaxed">
              Our Code Reviewer agent assesses every PR. Our Monitoring Agent
              reads your cluster over kubectl and diagnoses what broke.
            </p>
            <p className="text-foreground mt-4 text-[16px] font-semibold">
              Your keys never reach the agent.
            </p>
          </div>

          <div className="-order-1 flex flex-1 items-center justify-center lg:order-none">
            <div className="relative w-full max-w-[440px]">
              <div
                className="absolute -top-14 -right-12 hidden sm:block"
                style={{ width: 460, height: 147 }}
                aria-hidden="true"
              >
                <svg
                  viewBox="933 1901 1616 516"
                  className="h-full w-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M933 1901C1075.54 2205.17 1384.28 2417 1741.93 2417C2099.83 2417 2406.59 2205.51 2549 1901H933Z"
                    fill={SHAPE_COLOR.gold}
                  />
                </svg>
              </div>
              <ClusterWatchCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClusterWatchCard() {
  return (
    <div
      className="relative z-10 w-full overflow-hidden rounded-xl border border-[#333] bg-[#1e1e1e] shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
      aria-hidden="true"
    >
      <div className="flex items-center gap-px border-b border-[#333] bg-[#252526]">
        <div className="flex items-center gap-2 bg-[#1e1e1e] px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#d4d4d4]">
            cluster-watch
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-3 py-2.5">
          <div className="size-2 rounded-full bg-amber-500" />
          <span className="text-[11px] text-[#808080]">
            Investigating · prod-us-east
          </span>
        </div>
      </div>

      <div className="p-4 font-mono text-[12px] leading-[1.7] text-[#d4d4d4]">
        <p>
          <span className="text-[#6A9955]">$</span>{" "}
          <span className="text-[#dcdcaa]">kubectl</span> get pods -n checkout
        </p>
        <div className="mt-2">
          <div className="flex gap-4 text-[#808080]">
            <span className="w-[140px]">NAME</span>
            <span>STATUS</span>
          </div>
          <div className="flex gap-4">
            <span className="w-[140px] text-[#d4d4d4]">payments-72fx</span>
            <span className="text-[#f87171]">CrashLoopBackOff</span>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-[#333] bg-[#252526] p-3">
          <p className="text-[11px] font-semibold tracking-wider text-[#808080] uppercase">
            Diagnosis
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#ccc]">
            The payments pod is OOM-killed. Current limit is 256Mi; the pod
            peaked at 420Mi after the price-calc migration.
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <span className="rounded-md border border-[#555] px-3 py-1.5 text-[12px] font-medium text-[#d4d4d4]">
            Raise limit to 512M
          </span>
          <span className="rounded-md bg-[#3b82f6] px-3 py-1.5 text-[12px] font-medium text-white">
            Open PR
          </span>
        </div>
      </div>
    </div>
  );
}
