import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import {
  durationSegments,
  formatTokens,
  formatUsdCents,
} from "../lib/format.js";

interface Props {
  costUsd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/** Subordinated run inside a figure — units and secondary values, so the digits
 *  that matter stay the ones you read first. Inherits the figure's weight so the
 *  two stay matched. */
function Sub({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}

// `dt`/`dd` pair the label with its figure, so jumping straight to a number
// still carries what the number is.
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 whitespace-nowrap font-mono text-xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {children}
      </dd>
    </Card>
  );
}

/** The month's headline figures. Takes already-summed primitives so the caller
 *  owns the arithmetic and this stays presentation only. */
export function SpendStatCards({
  costUsd,
  calls,
  tokensIn,
  tokensOut,
  durationMs,
}: Props) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Total cost">{formatUsdCents(costUsd)}</Stat>
      <Stat label="API calls">{calls.toLocaleString()}</Stat>
      <Stat label="Tokens in / out">
        {formatTokens(tokensIn)}
        <Sub>
          {/* Tighter than a mono space, which is wide enough to read as a gap. */}
          <span className="mx-1">/</span>
          {formatTokens(tokensOut)}
        </Sub>
      </Stat>
      <Stat label="Model time">
        {durationSegments(durationMs).map((segment, i) =>
          segment.unit ? (
            <Sub key={i}>{segment.text}</Sub>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </Stat>
    </dl>
  );
}
