import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { useApprovalsForOwner } from "../api/queries.js";
import { EgressApprovalToast } from "./egress-approval-toast.js";

const EMPTY: never[] = [];

const FOREIGN_TOAST_MS = 60_000;

/** Upper-right egress-approval toast stack. The viewed sandbox's toasts stay
 *  until acted on; foreign ones hide after a timeout but the row stays
 *  pending in the Inbox — same polled rows, same verdict mutations. */
export function EgressApprovalToasts({ agentId }: { agentId: string | null }) {
  const { data: rows = EMPTY } = useApprovalsForOwner();
  const pendingEgress = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.type === "ext_authz"),
    [rows],
  );

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Expansion is state (not CSS hover) so collapsed rear cards can be made
  // inert — otherwise their occluded buttons stay clickable and tabbable.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const pendingIds = new Set(pendingEgress.map((r) => r.id));
    const ownIds = new Set(
      pendingEgress.filter((r) => r.agentId === agentId).map((r) => r.id),
    );
    for (const row of pendingEgress) {
      if (ownIds.has(row.id) || timers.current.has(row.id)) continue;
      timers.current.set(
        row.id,
        setTimeout(
          () => setHidden((prev) => new Set(prev).add(row.id)),
          FOREIGN_TOAST_MS,
        ),
      );
    }
    // Prune resolved rows, and own rows so they get a fresh timeout if their
    // sandbox is left again.
    for (const [id, timer] of timers.current) {
      if (!pendingIds.has(id) || ownIds.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    setHidden((prev) => {
      const kept = [...prev].filter(
        (id) => pendingIds.has(id) && !ownIds.has(id),
      );
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [pendingEgress, agentId]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  const visible = pendingEgress.filter(
    (r) => r.agentId === agentId || !hidden.has(r.id),
  );
  if (visible.length === 0) return null;

  // Collapsed by default: the newest toast in front, the rest peeking out
  // beneath it; hovering or focusing the stack expands it to a column.
  return (
    <div
      aria-live="polite"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
      }}
      className="absolute top-4 max-md:top-[78px] right-4 z-40 max-md:z-[60] w-[400px] max-w-[calc(100vw-32px)]"
    >
      {visible.map((row, i) => {
        const rear = i > 0 && !expanded;
        return (
          <div
            key={row.id}
            inert={rear}
            style={
              {
                "--stack-z": visible.length - i,
                "--stack-y": `${Math.min(i, 3) * 12}px`,
                "--stack-scale": `${1 - Math.min(i, 3) * 0.03}`,
              } as CSSProperties
            }
            className={cn(
              "relative z-[var(--stack-z)] transition-all duration-200",
              rear &&
                "absolute inset-x-0 top-0 origin-top [transform:translateY(var(--stack-y))_scale(var(--stack-scale))] pointer-events-none",
              i > 0 && !rear && "mt-3",
            )}
          >
            <EgressApprovalToast row={row} foreign={row.agentId !== agentId} />
          </div>
        );
      })}
    </div>
  );
}
