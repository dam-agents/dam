import type { CreditSpend } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import {
  durationSegments,
  formatSpend,
  formatTokens,
  formatUsdCents,
} from "../lib/format.js";

interface Props {
  costUsd: number;
  credits: CreditSpend[];
  calls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}

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

export function SpendStatCards({
  costUsd,
  credits,
  calls,
  tokensIn,
  tokensOut,
  durationMs,
}: Props) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Total cost">
        {formatSpend(costUsd, credits, formatUsdCents)}
      </Stat>
      <Stat label="API calls">{calls.toLocaleString()}</Stat>
      <Stat label="Tokens in / out">
        {formatTokens(tokensIn)}
        <Sub>
          {}
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
